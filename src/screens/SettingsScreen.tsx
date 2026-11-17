import { useEffect, useState } from 'react'
import { Smartphone, RefreshCw, LogOut, ShieldCheck, Server, Info, Download } from 'lucide-react'
import { useRemoteStore } from '../lib/store'
import { SCOPE_LABELS } from '../shared/remote/protocol'
import { version as appVersion } from '../../package.json'
import { installAppUpdate, useUpdateStore } from '../lib/update'
import { servedEndpoint } from '../lib/store'

export function SettingsScreen() {
  const { device, endpoint, status, workspace, connect, forget, send } = useRemoteStore()
  const [info, setInfo] = useState<{ ide: string; ideVersion: string; protocolVersion: number; platform: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updates = useUpdateStore()
  const web = !!servedEndpoint()

  // Refetch on every (re)authentication: the IDE may have been updated or restarted meanwhile.
  useEffect(() => {
    if (status !== 'open') return
    void send<typeof info>('system.info').then(setInfo).catch(() => { /* offline */ })
  }, [status, device, send])

  const reconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await connect()
    } catch (e) {
      setError((e as Error).message || 'connessione fallita')
    } finally {
      setBusy(false)
    }
  }

  const unpair = async () => {
    if (!window.confirm('Disassociare questo telefono da DamnedIDE? Per riusarlo servirà un nuovo QR.')) return
    setBusy(true)
    await forget()
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
        <div className="muted">I permessi si modificano dall’IDE (Impostazioni → Accesso remoto).</div>
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
        {error && <div className="error-banner">{error}</div>}
      </div>

      <div className="card">
        <div className="row">
          <Info size={15} color="var(--accent)" />
          <strong>Versioni</strong>
        </div>
        <div className="row between"><span className="muted">App</span><span className="mono" style={{ fontSize: 12 }}>DamnedCloud {appVersion}</span></div>
        <div className="row between"><span className="muted">IDE</span><span className="mono" style={{ fontSize: 12 }}>{info ? `${info.ide} ${info.ideVersion}` : '—'}</span></div>
        <div className="row between"><span className="muted">Protocollo</span><span className="mono" style={{ fontSize: 12 }}>{info ? `v${info.protocolVersion}` : '—'}</span></div>
        {web ? (
          <div className="muted" style={{ fontSize: 12 }}>
            La webapp è quella inclusa in DamnedIDE: quando aggiorni l’IDE la pagina si ricarica da sola con la nuova versione.
          </div>
        ) : updates.update ? (
          <button className="btn primary" onClick={installAppUpdate}>
            <Download size={15} /> aggiorna a {updates.update.latest}
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => void updates.check(true)} disabled={updates.checking}>
              <RefreshCw size={15} /> {updates.checking ? 'verifica in corso…' : 'verifica aggiornamenti'}
            </button>
            {updates.error ? (
              <div className="error-banner">{updates.error}</div>
            ) : updates.checkedAt > 0 && !updates.checking ? (
              <div className="muted" style={{ fontSize: 12 }}>Hai l’ultima versione.</div>
            ) : null}
          </>
        )}
      </div>

      <button className="btn danger" onClick={() => void unpair()} disabled={busy}>
        <LogOut size={15} /> disassocia e esci
      </button>
    </>
  )
}
