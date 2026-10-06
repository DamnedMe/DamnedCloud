import { create } from 'zustand'
import { RemoteConnection, RemoteError, type ConnState, type ConnectionInfo } from './connection'
import { fromBase64Url, type DeviceInfo, type PairingPayload, type PairingResult, type RemoteSqlConnection, type WorkspaceSnapshot } from '../shared/remote/protocol'

const SESSION_KEY = 'damnedcloud.session'

export const connection = new RemoteConnection()

interface PersistedSession {
  host: string
  port: number
  tls: boolean
  token: string
  deviceName: string
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

  load: () => void
  setEndpoint: (endpoint: ConnectionInfo) => void
  connect: () => Promise<void>
  pair: (payload: PairingPayload) => Promise<void>
  pairWithCode: (input: string) => Promise<void>
  disconnect: () => void
  send: <T = unknown>(cmd: string, args?: unknown) => Promise<T>
}

export const useRemoteStore = create<RemoteState>((set, get) => {
  connection.onState((status, detail) => set({ status, detail: detail ?? null }))
  connection.on('workspace.changed', (data) => set({ workspace: data as WorkspaceSnapshot }))

  const persist = () => {
    const { endpoint, token } = get()
    if (token) saveSession({ ...endpoint, token, deviceName: deviceName() })
  }

  const authenticate = async (): Promise<void> => {
    const hello = await connection.request<{ protocolVersion: number }>('hello')
    void hello
    const { token } = get()
    if (!token) return
    const device = await connection.request<DeviceInfo>('auth', { token, platform: devicePlatform() })
    set({ device, error: null })
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

    load: () => {
      const session = loadSession()
      if (session) {
        set({
          endpoint: { host: session.host, port: session.port, tls: session.tls },
          token: session.token,
          booted: true
        })
        // Reconnect quietly in the background.
        void get().connect().catch(() => { /* offline */ })
      } else {
        set({ booted: true })
      }
    },

    setEndpoint: (endpoint) => {
      set({ endpoint })
      if (get().token) saveSession({ ...endpoint, token: get().token!, deviceName: deviceName() })
    },

    connect: async () => {
      const { endpoint, token } = get()
      if (!endpoint.host) throw new Error('indirizzo mancante')
      set({ error: null })
      await connection.connect(endpoint)
      if (token) await authenticate()
    },

    pair: async (payload) => {
      const endpoint: ConnectionInfo = { host: payload.host, port: payload.port, tls: payload.tls }
      set({ endpoint, error: null })
      await connection.connect(endpoint)
      await connection.request('hello')
      const result = await connection.request<PairingResult>('pair', {
        token: payload.token,
        name: deviceName(),
        platform: devicePlatform()
      })
      set({ token: result.token, device: result.device })
      saveSession({ ...endpoint, token: result.token, deviceName: deviceName() })
    },

    pairWithCode: async (input) => {
      const trimmed = input.trim()
      // Accept a raw base64url pairing payload or a full URL containing one.
      let encoded = trimmed
      const hashIndex = Math.max(trimmed.indexOf('#'), trimmed.indexOf('?d='))
      if (hashIndex >= 0) encoded = trimmed.slice(hashIndex + 1).replace(/^d=/, '')
      let payload: PairingPayload
      try {
        payload = JSON.parse(fromBase64Url(encoded)) as PairingPayload
      } catch {
        throw new Error('codice di associazione non valido')
      }
      await get().pair(payload)
    },

    disconnect: () => {
      connection.close()
      saveSession(null)
      set({ token: null, device: null, workspace: null, error: null })
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

/**
 * Execute a command that may require an explicit confirmation (destructive
 * actions). On a `confirmation_required` error it shows the summary and retries
 * with the challenge id once the user accepts.
 */
export async function sendConfirmed<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await connection.request<T>(cmd, args)
  } catch (err) {
    if (err instanceof RemoteError && err.challenge) {
      const details = err.challenge.details ? `\n\n${err.challenge.details}` : ''
      const accepted = window.confirm(`${err.challenge.summary}${details}`)
      if (accepted) return connection.request<T>(cmd, { ...args, confirm: err.challenge.id })
    }
    throw err
  }
}
