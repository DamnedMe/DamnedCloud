import { useState } from 'react'
import { QrCode, Link2, Loader2, RefreshCw, MonitorCheck } from 'lucide-react'
import { useRemoteStore } from '../lib/store'

export function PairingScreen() {
  const { pairWithCode, connect, error, status, detail, token, pairing, pairingCode } = useRemoteStore()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

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
          <strong>1. Installa e associa</strong>
        </div>
        <div className="muted">
          Apri DamnedIDE su PC → Impostazioni → Accesso remoto → attiva → genera QR, poi scansiona il QR col telefono.
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
        <button className="btn primary" onClick={() => void pair()} disabled={pairing || busy || !code.trim()}>
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

      <div className="muted mono" style={{ textAlign: 'center', fontSize: 11 }}>
        stato: {status}
        {detail ? ` · ${detail}` : ''}
      </div>
    </div>
  )
}
