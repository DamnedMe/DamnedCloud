import { useState } from 'react'
import { QrCode, Link2, Loader2, RefreshCw, MonitorCheck, ScanLine } from 'lucide-react'
import { servedEndpoint, useRemoteStore } from '../lib/store'
import { QrScanner } from '../components/QrScanner'

/** In the LAN webapp the bridge is this page's own origin: no APK, no QR to scan. */
const WEB = !!servedEndpoint()

export function PairingScreen() {
  const { pairWithCode, connect, error, status, detail, token, pairing, pairingCode } = useRemoteStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const scanned = (text: string) => {
    setScanning(false)
    setLocalError(null)
    void pairWithCode(text).catch(() => { /* shown from the store's `error` */ })
  }

  const pair = async () => {
    if (!code.trim()) return
    setLocalError(null)
    await pairWithCode(code).catch(() => { /* the store puts the failure in `error`, shown below */ })
  }

  const reconnect = async () => {
    setBusy(true)
    setLocalError(null)
    try {
      await connect()
    } catch (e) {
      setLocalError((e as Error).message || 'connessione fallita')
    } finally {
      setBusy(false)
    }
  }

  const message = localError || error

  return (
    <div className="center-screen">
      <div className="logo">DAMNEDCLOUD</div>
      <div className="muted" style={{ textAlign: 'center' }}>
        Controllo remoto di DamnedIDE
      </div>

      {pairing && (
        <div className="card">
          <div className="row">
            <MonitorCheck size={18} color="var(--accent)" />
            <strong>Conferma l’associazione su DamnedIDE</strong>
          </div>
          <div className="row">
            <span className="spinner" />
            <span className="muted">
              {pairingCode ? `Conferma sul PC: codice ${pairingCode}` : 'In attesa della conferma sul PC…'}
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row">
          <QrCode size={18} color="var(--accent)" />
          <strong>Associa {WEB ? 'questo browser' : 'il telefono'}</strong>
        </div>
        <div className="muted">
          Su PC apri DamnedIDE → Impostazioni → Accesso remoto → <strong>{WEB ? 'Browser (webapp)' : 'App Android'}</strong> →
          genera QR di associazione,{' '}
          {WEB
            ? "poi inquadralo con l'app Fotocamera del telefono (apre la webapp già associata) o con «Scansiona QR»."
            : 'poi inquadralo con «Scansiona QR».'}{' '}
          Sul PC compare un codice da confermare.
        </div>
        <button className="btn primary" onClick={() => setScanning(true)} disabled={pairing}>
          <ScanLine size={15} /> Scansiona QR
        </button>
        {!WEB && (
          <div className="muted">
            Serve <strong>Tailscale</strong> attivo su telefono e PC, con lo stesso account.
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <Link2 size={18} color="var(--accent)" />
          <strong>Associazione manuale</strong>
        </div>
        <label className="field">
          Codice o link di associazione
          <textarea
            rows={3}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={WEB ? 'codice o link copiato da DamnedIDE' : 'damnedcloud://pair?... oppure il codice copiato da DamnedIDE'}
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          />
        </label>
        <button className="btn" onClick={() => void pair()} disabled={pairing || busy || !code.trim()}>
          {pairing ? <Loader2 size={15} className="spinner" /> : <QrCode size={15} />}
          Associa
        </button>
      </div>

      {token && (
        <button className="btn" onClick={() => void reconnect()} disabled={busy || pairing}>
          {busy ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />}
          Riconnetti al desktop
        </button>
      )}

      {message && <div className="error-banner">{message}</div>}

      {scanning && <QrScanner onResult={scanned} onClose={() => setScanning(false)} />}

      <div className="muted mono" style={{ textAlign: 'center', fontSize: 11 }}>
        stato: {status}
        {detail ? ` · ${detail}` : ''}
      </div>
    </div>
  )
}
