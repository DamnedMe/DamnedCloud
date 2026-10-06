import { useState } from 'react'
import { QrCode, Link2, Loader2, RefreshCw } from 'lucide-react'
import { useRemoteStore } from '../lib/store'

export function PairingScreen() {
  const { pairWithCode, connect, error, status, detail, token } = useRemoteStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const pair = async () => {
    if (!code.trim()) return
    setBusy(true)
    setLocalError(null)
    try {
      await pairWithCode(code)
    } catch (e) {
      setLocalError((e as Error).message || 'associazione fallita')
    } finally {
      setBusy(false)
    }
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

      <div className="card">
        <div className="row">
          <QrCode size={18} color="var(--accent)" />
          <strong>1. Installa e associa</strong>
        </div>
        <div className="muted">
          Apri DamnedIDE su PC → Impostazioni → Mobile → “associa telefono”, poi scansiona il QR col telefono.
          Se DamnedCloud è già installato, il QR apre l’app e completa l’associazione.
        </div>
        <div className="muted">
          Assicurati che <strong>Tailscale</strong> sia attivo e connesso su telefono e PC.
        </div>
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
            placeholder="damnedcloud://pair?... oppure incolla il contenuto del QR"
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          />
        </label>
        <button className="btn primary" onClick={() => void pair()} disabled={busy || !code.trim()}>
          {busy ? <Loader2 size={15} className="spinner" /> : <QrCode size={15} />}
          Associa
        </button>
      </div>

      {token && (
        <button className="btn" onClick={() => void reconnect()} disabled={busy}>
          {busy ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />}
          Riconnetti al desktop
        </button>
      )}

      {message && <div className="error-banner">{message}</div>}

      <div className="muted mono" style={{ textAlign: 'center', fontSize: 11 }}>
        stato: {status}
        {detail ? ` · ${detail}` : ''}
      </div>
    </div>
  )
}
