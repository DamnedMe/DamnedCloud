import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'

/** Longest side the frames are scaled to before decoding: enough for a QR on screen, cheap on a phone. */
const MAX_SIDE = 720

function decode(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(data, canvas.width, canvas.height)?.data || null
}

/**
 * Full-screen QR reader. Live camera where the page may use it (the app; a webapp on https or
 * localhost); a plain-http webapp on the LAN gets no camera stream from the browser, so it takes a
 * photo of the QR instead and decodes that.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'))
  const fileRef = useRef<HTMLInputElement>(null)
  const [live, setLive] = useState(() => !!navigator.mediaDevices?.getUserMedia)
  const [error, setError] = useState<string | null>(null)
  const resultRef = useRef(onResult)
  resultRef.current = onResult

  useEffect(() => {
    if (!live) return
    let stream: MediaStream | null = null
    let timer = 0
    let done = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(async (s) => {
        stream = s
        if (done) return s.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = s
        await video.play().catch(() => {})
        const tick = () => {
          if (done) return
          if (video.readyState >= 2 && video.videoWidth) {
            const text = decode(video, video.videoWidth, video.videoHeight, canvasRef.current)
            if (text) {
              done = true
              resultRef.current(text)
              return
            }
          }
          timer = window.setTimeout(tick, 200)
        }
        tick()
      })
      .catch(() => {
        // permission denied or no camera: the photo path still works
        setError('Fotocamera non disponibile: scatta una foto del QR.')
        setLive(false)
      })
    return () => {
      done = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [live])

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const bitmap = await createImageBitmap(file)
      const text = decode(bitmap, bitmap.width, bitmap.height, canvasRef.current)
      bitmap.close()
      if (text) onResult(text)
      else setError('Nessun QR trovato nella foto: riprova più vicino e a fuoco.')
    } catch {
      setError('Impossibile leggere la foto.')
    }
  }

  return (
    <div className="scanner">
      <div className="scanner-bar">
        <strong>Scansiona il QR di associazione</strong>
        <button className="btn small" onClick={onClose} aria-label="Chiudi">
          <X size={18} />
        </button>
      </div>
      {live ? (
        <div className="scanner-view">
          <video ref={videoRef} playsInline muted />
          <div className="scanner-frame" />
        </div>
      ) : (
        <div className="scanner-view scanner-photo">
          <Camera size={42} color="var(--accent)" />
          <div className="muted" style={{ textAlign: 'center' }}>
            In DamnedIDE → Accesso remoto genera il QR di associazione, poi scattagli una foto.
          </div>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void fromPhoto(e.target.files?.[0])} />
      <button className="btn" onClick={() => fileRef.current?.click()}>
        <Camera size={15} /> {live ? 'Usa una foto' : 'Scatta una foto del QR'}
      </button>
    </div>
  )
}
