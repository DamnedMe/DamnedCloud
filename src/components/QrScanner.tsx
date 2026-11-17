import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

/** Longest side the framed centre of a live frame is scaled to before decoding: cheap on a phone. */
const LIVE_SIDE = 960
/**
 * A photo of a screen shows the (dense) pairing QR small: at 720 px its modules blur together, so
 * photos are decoded larger first (1280, then 2048 if that fails).
 */
const PHOTO_SIDES = [1280, 2048]

/** Decodes the region (sx, sy, w, h) of `source`, scaled down to `maxSide` at most. */
function decode(source: CanvasImageSource, [sx, sy, width, height]: number[], canvas: HTMLCanvasElement, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, sx, sy, width, height, 0, 0, canvas.width, canvas.height)
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
      // Ask for HD: the default stream is often 640x480, too coarse for the dense pairing QR on a screen.
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        stream = s
        if (done) return s.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = s
        await video.play().catch(() => {})
        const tick = () => {
          if (done) return
          if (video.readyState >= 2 && video.videoWidth) {
            // Only the framed centre, at full resolution: the QR fills it, nothing gets scaled away.
            const vw = video.videoWidth, vh = video.videoHeight, side = Math.round(Math.min(vw, vh) * 0.8)
            const text = decode(video, [(vw - side) / 2, (vh - side) / 2, side, side], canvasRef.current, LIVE_SIDE)
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
      let text: string | null = null
      for (const side of PHOTO_SIDES) if (!text) text = decode(bitmap, [0, 0, bitmap.width, bitmap.height], canvasRef.current, side)
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
            {Capacitor.isNativePlatform()
              ? 'Scatta una foto del QR di associazione mostrato da DamnedIDE.'
              : "Qui il browser non concede la fotocamera dal vivo. Più comodo: inquadra il QR di associazione di DamnedIDE con l'app Fotocamera del telefono, si apre la webapp già associata. Oppure scattagli una foto."}
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
