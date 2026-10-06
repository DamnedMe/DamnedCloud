import { useEffect, useState } from 'react'
import { Smartphone, RefreshCw, LogOut, ShieldCheck, Server, Info } from 'lucide-react'
import { useRemoteStore } from '../lib/store'
import { SCOPE_LABELS } from '../shared/remote/protocol'

export function SettingsScreen() {
  const { device, endpoint, status, workspace, connect, disconnect, send } = useRemoteStore()
  const [info, setInfo] = useState<{ ide: string; ideVersion: string; protocolVersion: number; platform: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void send<typeof info>('system.info').then(setInfo).catch(() => { /* offline */ })
  }, [send])

  const reconnect = async () => {
    setBusy(true)
    try {
      await connect()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row between">
        <div className="row">
          <Smartphone size={16} color="var(--accent)" />
          <strong>Dispositivo</strong>
        </div>
        <span className={`pill ${status === 'open' ? 'ok' : status === 'error' ? 'err' : ''}`}>{status}</span>
      </div>

      <div className="card">
        <div className="row between">
          <span className="muted">Nome</span>
          <span>{device?.name ?? '—'}</span>
        </div>
        <div className="row between">
          <span className="muted">Piattaforma</span>
          <span className="mono" style={{ fontSize: 12 }}>{device?.platform ?? '—'}</span>
        </div>
        <div className="row between">
          <span className="muted">Ultimo accesso</span>
          <span className="mono" style={{ fontSize: 12 }}>{device?.lastSeen ? new Date(device.lastSeen).toLocaleString() : '—'}</span>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <ShieldCheck size={15} color="var(--accent)" />
          <strong>Permessi</strong>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(device?.scopes ?? []).map((s) => (
            <span key={s} className="pill ok">{SCOPE_LABELS[s]}</span>
          ))}
          {!device?.scopes?.length && <span className="muted">nessun permesso</span>}
        </div>
        <div className="muted">I permessi si modificano dall’IDE (Impostazioni → Mobile).</div>
      </div>

      <div className="card">
        <div className="row">
          <Server size={15} color="var(--accent)" />
          <strong>Connessione</strong>
        </div>
        <div className="row between">
          <span className="muted">Bridge</span>
          <span className="mono" style={{ fontSize: 12 }}>{endpoint.host || '—'}:{endpoint.port} {endpoint.tls ? 'wss' : 'ws'}</span>
        </div>
        <div className="row between">
          <span className="muted">Repository attivo</span>
          <span className="mono" style={{ fontSize: 11, maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all' }}>{workspace?.repoPath ?? '—'}</span>
        </div>
        <button className="btn" onClick={() => void reconnect()} disabled={busy}>
          <RefreshCw size={15} /> riconnetti
        </button>
      </div>

      {info && (
        <div className="card">
          <div className="row">
            <Info size={15} color="var(--accent)" />
            <strong>Desktop</strong>
          </div>
          <div className="row between"><span className="muted">IDE</span><span className="mono" style={{ fontSize: 12 }}>{info.ide} {info.ideVersion}</span></div>
          <div className="row between"><span className="muted">Protocollo</span><span className="mono" style={{ fontSize: 12 }}>v{info.protocolVersion}</span></div>
        </div>
      )}

      <button className="btn danger" onClick={disconnect}>
        <LogOut size={15} /> disassocia e esci
      </button>
    </>
  )
}
