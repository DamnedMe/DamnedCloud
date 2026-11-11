import { create } from 'zustand'
import { RemoteConnection, RemoteError, type ConnState, type ConnectionInfo } from './connection'
import { fromBase64Url, type DeviceInfo, type PairingPayload, type PairingPendingEvent, type PairingResult, type RemoteSqlConnection, type WorkspaceSnapshot } from '../shared/remote/protocol'

const SESSION_KEY = 'damnedcloud.session'
const USED_LINKS_KEY = 'damnedcloud.usedPairingTokens'
/** Backoff between automatic reconnects after a drop; the last step repeats. */
const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 20000, 30000]
/** Close code the bridge uses when the desktop revokes this device. */
const CLOSE_REVOKED = 4401
const REVOKED_MESSAGE = 'Dispositivo revocato dal PC: associa di nuovo'

export const connection = new RemoteConnection()

interface PersistedSession {
  host: string
  port: number
  tls: boolean
  token: string
  deviceName: string
  /** Last device the bridge returned: an offline cold start still shows the tabs (absent in sessions of older builds). */
  device?: DeviceInfo | null
}

function loadSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) return JSON.parse(raw) as PersistedSession
  } catch {
    /* ignore */
  }
  return null
}

function saveSession(session: PersistedSession | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

function usedPairingTokens(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(USED_LINKS_KEY) ?? '[]')
    return Array.isArray(list) ? (list as string[]) : []
  } catch {
    return []
  }
}

function markPairingTokenUsed(token: string): void {
  try {
    // Pairing tokens are single use with a short TTL: the last few are enough.
    localStorage.setItem(USED_LINKS_KEY, JSON.stringify([...usedPairingTokens(), token].slice(-20)))
  } catch {
    /* ignore */
  }
}

/** Accepts a raw base64url pairing payload or a full URL (landing page or deep link) containing one. */
function parsePairingInput(input: string): PairingPayload {
  const trimmed = input.trim()
  let encoded = trimmed
  const hashIndex = Math.max(trimmed.indexOf('#'), trimmed.indexOf('?d='))
  if (hashIndex >= 0) encoded = trimmed.slice(hashIndex + 1).replace(/^d=/, '')
  let payload: PairingPayload | null = null
  try {
    payload = JSON.parse(fromBase64Url(encoded)) as PairingPayload
  } catch {
    /* reported below */
  }
  if (!payload?.token || !payload.host) throw new Error('codice di associazione non valido')
  return payload
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as Error)?.message || fallback
}

function devicePlatform(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  return 'web'
}

export function deviceName(): string {
  const platform = devicePlatform()
  return platform === 'android' ? 'Telefono Android' : platform === 'ios' ? 'iPhone' : 'Browser'
}

interface RemoteState {
  endpoint: ConnectionInfo
  token: string | null
  device: DeviceInfo | null
  workspace: WorkspaceSnapshot | null
  status: ConnState
  detail: string | null
  error: string | null
  booted: boolean
  /** A pairing request is waiting for the desktop user to confirm it. */
  pairing: boolean
  /** Code the desktop shows for the pending pairing ('pairing.pending'; IDE 0.1.0 never sends it). */
  pairingCode: string | null

  load: () => void
  setEndpoint: (endpoint: ConnectionInfo) => void
  connect: () => Promise<void>
  /** Reconnects when the app returns to the foreground with a dropped session. */
  resume: () => void
  pair: (payload: PairingPayload) => Promise<void>
  pairWithCode: (input: string) => Promise<void>
  /** Deep link / URL entry point: each pairing token is tried at most once. */
  openPairingLink: (url: string) => Promise<void>
  disconnect: () => void
  /** Asks the desktop to revoke this device, then forgets the session locally. */
  forget: () => Promise<void>
  send: <T = unknown>(cmd: string, args?: unknown) => Promise<T>
}

export const useRemoteStore = create<RemoteState>((set, get) => {
  // Bumped by every connect/pair/disconnect: a slower attempt that got superseded
  // must not close the newer socket, overwrite its session or schedule retries.
  let attemptSeq = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryCount = 0
  /** Pairing token of the deep link being tried right now. */
  let linkInFlight: string | null = null

  const cancelRetry = () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    retryCount = 0
  }

  const scheduleReconnect = () => {
    if (retryTimer || !get().token || get().pairing) return
    const delay = RETRY_DELAYS_MS[Math.min(retryCount++, RETRY_DELAYS_MS.length - 1)]
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (!get().token || get().pairing || connection.isOpen || get().status === 'connecting') return
      void get().connect().catch(() => { /* connect schedules the next try */ })
    }, delay)
  }

  /** Saves the current session; called again whenever the device changes. */
  const persist = () => {
    const { endpoint, token, device } = get()
    if (token) saveSession({ ...endpoint, token, deviceName: deviceName(), device })
  }

  const dropSession = (error: string | null) => {
    attemptSeq++
    cancelRetry()
    connection.close()
    saveSession(null)
    set({ token: null, device: null, workspace: null, pairing: false, pairingCode: null, error })
  }

  connection.onState((status, detail) => set({ status, detail: detail ?? null }))
  connection.onClose((code) => {
    if (!get().token || get().pairing) return
    if (code === CLOSE_REVOKED) dropSession(REVOKED_MESSAGE)
    else scheduleReconnect()
  })
  connection.on('workspace.changed', (data) => set({ workspace: data as WorkspaceSnapshot }))
  connection.on('device.changed', (data) => {
    const device = data as DeviceInfo | null
    // The bridge pushes it only to this device's sockets; the id check is a cheap guard.
    if (device?.id && device.id === get().device?.id) {
      set({ device })
      persist()
    }
  })
  connection.on('pairing.pending', (data) => {
    if (get().pairing) set({ pairingCode: (data as PairingPendingEvent | null)?.code ?? null })
  })

  /** Authenticates the open socket with a device token and fetches the desktop workspace. */
  const authenticate = async (token: string): Promise<{ device: DeviceInfo; workspace: WorkspaceSnapshot | null }> => {
    const device = await connection.request<DeviceInfo>('auth', { token, platform: devicePlatform() })
    let workspace: WorkspaceSnapshot | null = null
    try {
      workspace = await connection.request<WorkspaceSnapshot>('workspace.state')
    } catch (err) {
      // The bridge answered (e.g. a device without the view scope): the session is fine, just without a snapshot.
      if (!(err instanceof RemoteError)) throw err
    }
    return { device, workspace }
  }

  return {
    endpoint: { host: '', port: 8765, tls: false },
    token: null,
    device: null,
    workspace: null,
    status: 'idle',
    detail: null,
    error: null,
    booted: false,
    pairing: false,
    pairingCode: null,

    load: () => {
      const session = loadSession()
      if (session) {
        set({
          endpoint: { host: session.host, port: session.port, tls: session.tls },
          token: session.token,
          device: session.device ?? null,
          booted: true
        })
        // Reconnect quietly in the background (the saved device keeps the tabs up meanwhile);
        // a refused token clears the session, device included.
        void get().connect().catch(() => { /* offline: connect schedules retries */ })
      } else {
        set({ booted: true })
      }
    },

    setEndpoint: (endpoint) => {
      set({ endpoint })
      persist()
    },

    connect: async () => {
      const { endpoint, token } = get()
      if (!endpoint.host) throw new Error('indirizzo mancante')
      const attempt = ++attemptSeq
      set({ pairing: false, pairingCode: null })
      let opened = false
      try {
        await connection.connect(endpoint)
        opened = true
        await connection.request('hello')
        if (!token) return
        const session = await authenticate(token)
        if (attempt !== attemptSeq) return
        cancelRetry()
        set({ ...session, error: null })
        persist()
      } catch (err) {
        if (attempt === attemptSeq) {
          if (err instanceof RemoteError && err.code === 'unauthorized') {
            dropSession(REVOKED_MESSAGE)
          } else {
            // An open but unauthenticated socket is useless: close it so the next try starts clean.
            if (opened) connection.close()
            scheduleReconnect()
          }
        }
        throw err
      }
    },

    resume: () => {
      const { token, pairing, status } = get()
      if (!token || pairing || connection.isOpen || status === 'connecting') return
      cancelRetry()
      void get().connect().catch(() => { /* connect schedules retries */ })
    },

    pair: async (payload) => {
      const endpoint: ConnectionInfo = { host: payload.host, port: payload.port, tls: payload.tls }
      const attempt = ++attemptSeq
      cancelRetry()
      set({ pairing: true, pairingCode: null, error: null })
      try {
        await connection.connect(endpoint)
        await connection.request('hello')
        const result = await connection.request<PairingResult>('pair', {
          token: payload.token,
          name: deviceName(),
          platform: devicePlatform()
        })
        // Newer bridges authenticate the socket on pair, IDE 0.1.0 does not: auth explicitly so both work.
        const session = await authenticate(result.token)
        if (attempt !== attemptSeq) return
        set({ endpoint, token: result.token, ...session, pairing: false, pairingCode: null, error: null })
        persist()
      } catch (err) {
        if (attempt === attemptSeq) {
          connection.close()
          set({ pairing: false, pairingCode: null, error: errorMessage(err, 'associazione fallita') })
          // A failed re-pair must not leave the previous, still valid session offline.
          if (get().token) void get().connect().catch(() => { /* connect schedules retries */ })
        }
        throw err
      }
    },

    pairWithCode: async (input) => {
      let payload: PairingPayload
      try {
        payload = parsePairingInput(input)
      } catch (err) {
        set({ error: errorMessage(err, 'codice di associazione non valido') })
        throw err
      }
      await get().pair(payload)
    },

    openPairingLink: async (url) => {
      let payload: PairingPayload
      try {
        payload = parsePairingInput(url)
      } catch (err) {
        set({ error: errorMessage(err, 'codice di associazione non valido') })
        throw err
      }
      // Capacitor replays the launch URL and a reload can bring an old link back: a token the
      // bridge already answered (or one still being tried) is skipped, so a stale link never
      // tears down a working session.
      if (usedPairingTokens().includes(payload.token) || linkInFlight === payload.token) return
      linkInFlight = payload.token
      try {
        await get().pair(payload)
        markPairingTokenUsed(payload.token)
      } catch (err) {
        // A bridge that never answered (unreachable, dropped) may still accept the token: the same QR can be scanned again.
        if (err instanceof RemoteError) markPairingTokenUsed(payload.token)
        throw err
      } finally {
        linkInFlight = null
      }
    },

    disconnect: () => dropSession(null),

    forget: async () => {
      const wasOpen = connection.isOpen
      cancelRetry()
      // Token first: the 4401 close the bridge answers with must not read as a remote revoke.
      set({ token: null })
      if (wasOpen) {
        const timeout = new Promise((resolve) => setTimeout(resolve, 3000))
        await Promise.race([connection.request('device.forget'), timeout]).catch(() => {
          /* IDE 0.1.0 answers unknown_command: the local session goes anyway */
        })
      }
      dropSession(null)
    },

    send: async <T = unknown>(cmd: string, args?: unknown) => {
      try {
        return await connection.request<T>(cmd, args)
      } catch (err) {
        if (err instanceof RemoteError) set({ error: err.message })
        throw err
      }
    }
  }
})

export type { RemoteSqlConnection }

/** The user said no to a bridge confirmation: nothing failed, nothing to show. */
export class ConfirmationDeclined extends Error {}

/**
 * Execute a command that may require an explicit confirmation (destructive
 * actions). On a `confirmation_required` error it shows the summary and retries
 * with the challenge id once the user accepts; a refusal throws ConfirmationDeclined.
 */
export async function sendConfirmed<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  let confirm: string | null = null
  for (let asked = 0; ; asked++) {
    try {
      return await connection.request<T>(cmd, confirm ? { ...args, confirm } : args)
    } catch (err) {
      if (!(err instanceof RemoteError && err.challenge)) throw err
      // A new challenge right after an accept: the first one expired (2 minutes, or the desktop
      // restarted while the dialog was open). Ask once more, then give up with a visible error.
      if (asked === 2) throw new Error('Conferma scaduta sul desktop: riprova')
      const expired = asked ? 'La conferma è scaduta, conferma di nuovo.\n\n' : ''
      const details = err.challenge.details ? `\n\n${err.challenge.details}` : ''
      if (!window.confirm(`${expired}${err.challenge.summary}${details}`)) throw new ConfirmationDeclined(err.message)
      confirm = err.challenge.id
    }
  }
}
