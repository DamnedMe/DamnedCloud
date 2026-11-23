import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { Camera, X } from 'lucide-react'
import { Capacitor } from '@capacitor/core'

/** Longest side a live region is scaled to before jsQR decodes it: the dense pairing QR needs ~1000 px. */
const LIVE_SIDE = 1280
/**
 * A photo of a screen shows the (dense) pairing QR small: at 720 px its modules blur together, so
 * photos are decoded larger first (1280, then 2048 if that fails).
 */
const PHOTO_SIDES = [1280, 2048]
/** Pause between two live decodes. */
const TICK_MS = 120
/**
 * Starting zoom where the camera has one: phones cannot focus closer than ~10 cm, so without zoom the
 * QR on a monitor is framed big only when it is already too close to be sharp. At 2x it fills the
 * frame from a distance the lens focuses at.
 */
const START_ZOOM = 2

// Camera controls Chromium (Android WebView included) exposes on the video track; lib.dom lacks them.
type FocusMode = 'continuous' | 'single-shot' | 'manual' | 'none'
interface CameraCaps {
  focusMode?: FocusMode[]
  zoom?: { min: number; max: number; step?: number }
}
type CameraConstraint = MediaTrackConstraintSet & {
  focusMode?: FocusMode
  zoom?: number
  pointsOfInterest?: { x: number; y: number }[]
}

// Shape Detection API: Android Chromium decodes QRs natively (much better than jsQR on blurry frames).
interface DetectedBarcode { rawValue: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): BarcodeDetectorLike
      getSupportedFormats(): Promise<string[]>
    }
  }
}

async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  try {
    const BD = window.BarcodeDetector
    if (!BD || !(await BD.getSupportedFormats()).includes('qr_code')) return null
    return new BD({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

/** Decodes the region (sx, sy, w, h) of `source` with jsQR, scaled down to `maxSide` at most. */
function decode(source: CanvasImageSource, [sx, sy, width, height]: number[], canvas: HTMLCanvasElement, maxSide: number): string | null {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingQuality = 'high'
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
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const capsRef = useRef<CameraCaps>({})
  const refocusRef = useRef(0)
  const [live, setLive] = useState(() => !!navigator.mediaDevices?.getUserMedia)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ value: number; min: number; max: number; step: number } | null>(null)
  const [focusAt, setFocusAt] = useState<{ x: number; y: number } | null>(null)
  const resultRef = useRef(onResult)
  resultRef.current = onResult

  useEffect(() => {
    if (!live) return
    let stream: MediaStream | null = null
    let timer = 0
    let done = false
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'environment',
          // HD: the default stream is often 640x480, too coarse for the dense pairing QR on a screen.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          // without it some WebViews leave the lens at a fixed (far) focus
          advanced: [{ focusMode: 'continuous' } as CameraConstraint],
        },
        audio: false,
      })
      .then(async (s) => {
        stream = s
        if (done) return s.getTracks().forEach((t) => t.stop())
        const track = s.getVideoTracks()[0]
        trackRef.current = track
        await setupCamera(track)
        const video = videoRef.current!
        video.srcObject = s
        await video.play().catch(() => {})
        const detector = await nativeDetector()
        let frame = 0
        const tick = async () => {
          if (done) return
          let text: string | null = null
          if (video.readyState >= 2 && video.videoWidth) {
            text = detector ? await detector.detect(video).then((r) => r[0]?.rawValue || null, () => null) : null
            if (!text) {
              // jsQR: the framed centre at full resolution most of the time (the QR fills it), the whole
              // frame now and then (a QR held off-centre).
              const vw = video.videoWidth, vh = video.videoHeight
              const side = Math.round(Math.min(vw, vh) * 0.8)
              const region = frame++ % 3 === 2 ? [0, 0, vw, vh] : [(vw - side) / 2, (vh - side) / 2, side, side]
              text = decode(video, region, canvasRef.current, LIVE_SIDE)
            }
          }
          if (done) return
          if (text) {
            done = true
            resultRef.current(text)
            return
          }
          timer = window.setTimeout(() => void tick(), TICK_MS)
        }
        void tick()
      })
      .catch(() => {
        // permission denied or no camera: the photo path still works
        setError('Fotocamera non disponibile: scatta una foto del QR.')
        setLive(false)
      })
    return () => {
      done = true
      clearTimeout(timer)
      clearTimeout(refocusRef.current)
      trackRef.current = null
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [live])

  /** Continuous autofocus and a starting zoom, where the camera offers them. */
  const setupCamera = async (track: MediaStreamTrack) => {
    const caps = ((track.getCapabilities?.() ?? {}) as CameraCaps)
    capsRef.current = caps
    const set: CameraConstraint = {}
    if (caps.focusMode?.includes('continuous')) set.focusMode = 'continuous'
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      const value = Math.min(caps.zoom.max, Math.max(caps.zoom.min, START_ZOOM))
      set.zoom = value
      setZoom({ value, min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1 })
    }
    if (Object.keys(set).length) await track.applyConstraints({ advanced: [set] }).catch(() => {})
  }

  const applyZoom = (value: number) => {
    setZoom((z) => (z ? { ...z, value } : z))
    void trackRef.current?.applyConstraints({ advanced: [{ zoom: value } as CameraConstraint] }).catch(() => {})
  }

  /** Tap to focus: a one-shot focus on the tapped point, then back to continuous. */
  const tapFocus = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current
    const modes = capsRef.current.focusMode
    if (!track || !modes?.length) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width, y = (e.clientY - box.top) / box.height
    setFocusAt({ x, y })
    const set: CameraConstraint = { pointsOfInterest: [{ x, y }] }
    if (modes.includes('single-shot')) set.focusMode = 'single-shot'
    else if (modes.includes('continuous')) set.focusMode = 'continuous'
    void track.applyConstraints({ advanced: [set] }).catch(() => {})
    clearTimeout(refocusRef.current)
    refocusRef.current = window.setTimeout(() => {
      setFocusAt(null)
      if (modes.includes('continuous') && trackRef.current === track) {
        void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as CameraConstraint] }).catch(() => {})
      }
    }, 1500)
  }

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      const bitmap = await createImageBitmap(file)
      const detector = await nativeDetector()
      let text = detector ? await detector.detect(bitmap).then((r) => r[0]?.rawValue || null, () => null) : null
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
        <div className="scanner-view" onPointerDown={tapFocus}>
          <video ref={videoRef} playsInline muted />
          <div className="scanner-frame" />
          {focusAt && <div className="scanner-focus" style={{ left: `${focusAt.x * 100}%`, top: `${focusAt.y * 100}%` }} />}
          <div className="scanner-hint">Se il QR è sfocato allontana un po' il telefono o tocca il QR per mettere a fuoco</div>
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
      {live && zoom && (
        <label className="scanner-zoom">
          <span>Zoom {zoom.value.toFixed(1)}x</span>
          <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={(e) => applyZoom(Number(e.target.value))} />
        </label>
      )}
      {error && <div className="error-banner">{error}</div>}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void fromPhoto(e.target.files?.[0])} />
      <button className="btn" onClick={() => fileRef.current?.click()}>
        <Camera size={15} /> {live ? 'Usa una foto' : 'Scatta una foto del QR'}
      </button>
    </div>
  )
}
