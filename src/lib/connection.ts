import {
  PROTOCOL_VERSION,
  type ConfirmationChallenge,
  type Envelope,
  type RemoteTopic,
  type ResErrEnvelope
} from '../shared/remote/protocol'

export interface ConnectionInfo {
  host: string
  port: number
  tls: boolean
}

export type ConnState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export class RemoteError extends Error {
  code: string
  challenge?: ConfirmationChallenge
  constructor(error: ResErrEnvelope['error']) {
    super(error.message)
    this.code = error.code
    this.challenge = error.challenge
  }
}

type Resolver = { resolve: (value: unknown) => void; reject: (error: unknown) => void }

/**
 * Thin WebSocket transport for the DamnedCloud protocol. It maps request/response
 * envelopes to promises and routes events to topic subscribers.
 */
export class RemoteConnection {
  private ws: WebSocket | null = null
  private seq = 0
  private readonly pending = new Map<string, Resolver>()
  private readonly topics = new Map<RemoteTopic, Set<(data: unknown) => void>>()
  private readonly stateListeners = new Set<(state: ConnState, detail?: string) => void>()
  private readonly closeListeners = new Set<(code: number) => void>()
  /** Rejects the in-flight connect() promise; cleared once that socket opens or is released. */
  private abortConnect: ((error: Error) => void) | null = null

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN
  }

  onState(listener: (state: ConnState, detail?: string) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /** Fires when an established connection drops on its own (not on close()); `code` is the WebSocket close code. */
  onClose(listener: (code: number) => void): () => void {
    this.closeListeners.add(listener)
    return () => this.closeListeners.delete(listener)
  }

  on(topic: RemoteTopic, listener: (data: unknown) => void): () => void {
    if (!this.topics.has(topic)) this.topics.set(topic, new Set())
    this.topics.get(topic)!.add(listener)
    return () => this.topics.get(topic)?.delete(listener)
  }

  connect(info: ConnectionInfo, timeoutMs = 12000): Promise<void> {
    this.close()
    this.emitState('connecting')
    return new Promise<void>((resolve, reject) => {
      const url = `${info.tls ? 'wss' : 'ws'}://${info.host}:${info.port}`
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (err) {
        this.emitState('error', String(err))
        reject(err)
        return
      }
      this.ws = socket
      let opened = false
      const timer = setTimeout(() => {
        if (this.ws !== socket || opened) return
        this.release('timeout di connessione')
        this.emitState('error', 'timeout')
      }, timeoutMs)
      this.abortConnect = (error) => {
        clearTimeout(timer)
        reject(error)
      }

      // Every handler checks it still owns this.ws: a replaced socket must not
      // touch the state, the pending requests or the topics of its successor.
      socket.onopen = () => {
        if (this.ws !== socket) return
        opened = true
        clearTimeout(timer)
        this.abortConnect = null
        this.emitState('open')
        resolve()
      }
      socket.onerror = () => {
        // After open, the close event that follows does the cleanup.
        if (this.ws !== socket || opened) return
        this.release('connessione al bridge fallita')
        this.emitState('error', 'connessione fallita')
      }
      socket.onclose = (event) => {
        if (this.ws !== socket) return
        this.release('connessione chiusa')
        this.emitState('closed')
        // A socket that never opened already rejected connect(); only a dropped session is news.
        if (opened) for (const listener of this.closeListeners) listener(event.code)
      }
      socket.onmessage = (event) => {
        if (this.ws === socket) this.onMessage(event.data)
      }
    })
  }

  close(): void {
    this.release('connessione chiusa')
    this.emitState('idle')
  }

  /**
   * Drops the current socket: detaches its handlers first (so its late events
   * are ignored and no close listener fires), rejects its pending requests and
   * an unfinished connect(), then closes it. Never leaves a dead socket in this.ws.
   */
  private release(reason: string): void {
    const socket = this.ws
    const abort = this.abortConnect
    this.ws = null
    this.abortConnect = null
    if (socket) {
      socket.onopen = socket.onerror = socket.onclose = socket.onmessage = null
      try {
        socket.close()
      } catch {
        /* ignore */
      }
    }
    for (const [, resolver] of this.pending) resolver.reject(new Error(reason))
    this.pending.clear()
    abort?.(new Error(reason))
  }

  request<T = unknown>(cmd: string, args?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('non connesso'))
    }
    const id = `r${++this.seq}`
    const envelope: Envelope = { v: PROTOCOL_VERSION, id, kind: 'req', cmd, args }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        this.ws!.send(JSON.stringify(envelope))
      } catch (err) {
        this.pending.delete(id)
        reject(err)
      }
    })
  }

  private onMessage(raw: unknown): void {
    let envelope: Envelope
    try {
      envelope = JSON.parse(String(raw)) as Envelope
    } catch {
      return
    }
    if (!envelope || envelope.v !== PROTOCOL_VERSION) return
    if (envelope.kind === 'res') {
      const resolver = this.pending.get(envelope.id)
      if (!resolver) return
      this.pending.delete(envelope.id)
      if (envelope.ok) resolver.resolve(envelope.data)
      else resolver.reject(new RemoteError(envelope.error))
    } else if (envelope.kind === 'evt') {
      for (const listener of this.topics.get(envelope.topic) ?? []) {
        try {
          listener(envelope.data)
        } catch {
          /* listener error */
        }
      }
    }
  }

  private emitState(state: ConnState, detail?: string): void {
    for (const listener of this.stateListeners) listener(state, detail)
  }
}
