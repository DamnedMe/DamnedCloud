import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowLeft, Columns2, Eye, FilePenLine, Loader2, Rows2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { firstChangeTarget, parseDiff, toSplitRows, type DiffLine } from '../lib/diff'
import { dirOf, fileNameOf } from '../shared/changeGroups'
import { useRemoteStore } from '../lib/store'
import { MarkdownView, isMarkdown } from '../components/MarkdownView'

const PREFS_KEY = 'damnedcloud.diff'
const FONT_MIN = 8
const FONT_MAX = 20

interface Prefs {
  fontSize: number
  split: boolean
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { fontSize: 12, split: false }
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null
    return {
      fontSize: typeof p?.fontSize === 'number' ? Math.min(FONT_MAX, Math.max(FONT_MIN, p.fontSize)) : fallback.fontSize,
      split: typeof p?.split === 'boolean' ? p.split : fallback.split
    }
  } catch {
    return fallback
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable: the choice lasts until the app closes */
  }
}

const SIGN: Partial<Record<DiffLine['kind'], string>> = { add: '+', del: '-' }

interface Props {
  /** repo-relative, as git.porcelain lists it */
  path: string
  /** null while loading */
  text: string | null
  /** the file exists in the worktree (not a deletion): the editor can open it */
  editable: boolean
  /** absolute path in the worktree: read for the rendered preview of a .md file */
  file: string
  /** landscape phone: the inspector takes the whole screen, with a back arrow */
  fill: boolean
  onClose: () => void
  onOpenEditor: (line: number) => void
}

export function DiffInspector({ path, text, editable, file, fill, onClose, onOpenEditor }: Props) {
  const send = useRemoteStore((s) => s.send)
  const [prefs, setPrefs] = useState(loadPrefs)
  const [picked, setPicked] = useState<DiffLine | null>(null)
  const lines = useMemo(() => (text ? parseDiff(text) : []), [text])
  const splitRows = useMemo(() => (prefs.split ? toSplitRows(lines) : []), [lines, prefs.split])

  useEffect(() => setPicked(null), [text])

  // .md: the file as it is now in the worktree, rendered (as the IDE's "preview")
  const [preview, setPreview] = useState(false)
  // tagged with its file: a bridge refresh keeps the old text on screen until the new one lands
  const [md, setMd] = useState<{ file: string; content: string } | null>(null)
  const canPreview = isMarkdown(path) && editable
  const showPreview = canPreview && preview
  useEffect(() => {
    if (!showPreview || text === null) return
    let live = true
    // the diff text changes when the file does: read it again with it
    send<{ content: string }>('fs.read', { file })
      .then((r) => { if (live) setMd({ file, content: r.content }) })
      .catch((e: Error) => { if (live) setMd({ file, content: `> ${e.message}` }) })
    return () => { live = false }
  }, [showPreview, file, text, send])

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    savePrefs(next)
  }

  const line = picked?.target ?? firstChangeTarget(lines)
  const digits = String(lines.reduce((max, l) => Math.max(max, l.old ?? 0, l.new ?? 0), 0)).length
  const bodyStyle = { fontSize: prefs.fontSize, '--ln-w': `${digits + 1}ch` } as CSSProperties
  const dir = dirOf(path)

  const lineClass = (l: DiffLine | null, base: string) =>
    `${base} ${l?.kind ?? 'empty'}${l && l === picked ? ' picked' : ''}`

  const half = (l: DiffLine | null, side: 'old' | 'new') => (
    <div className={lineClass(l, 'half')} onClick={l ? () => setPicked(l) : undefined}>
      <span className="ln">{l?.[side] ?? ''}</span>
      <span className="code">{l?.text ?? ''}</span>
    </div>
  )

  let body
  if (showPreview) {
    // the zoom works here too: 12 (the diff's default) is the preview's 13.5
    body = md?.file === file
      ? <MarkdownView content={md.content} className="md-inspector" style={{ fontSize: (prefs.fontSize * 13.5) / 12 }} />
      : <div className="diff-empty"><Loader2 size={16} className="spinner" /></div>
  } else if (text === null) {
    body = <div className="diff-empty"><Loader2 size={16} className="spinner" /></div>
  } else if (lines.length === 0) {
    // binary file, error, nothing to show: the bridge text as it is
    body = <pre className="diff-raw">{text.trim() || 'nessuna differenza'}</pre>
  } else if (prefs.split) {
    body = (
      <div className="diff-body split" style={bodyStyle}>
        {splitRows.map((r, i) =>
          r.left && r.left === r.right && r.left.kind !== 'ctx' ? (
            <div key={i} className={lineClass(r.left, 'dl')} onClick={() => setPicked(r.left)}>{r.left.text}</div>
          ) : (
            <div key={i} className="sl">
              {half(r.left, 'old')}
              {half(r.right, 'new')}
            </div>
          )
        )}
      </div>
    )
  } else {
    body = (
      <div className="diff-body unified" style={bodyStyle}>
        {lines.map((l, i) =>
          l.kind === 'hunk' || l.kind === 'meta' ? (
            <div key={i} className={lineClass(l, 'dl')} onClick={() => setPicked(l)}>{l.text}</div>
          ) : (
            <div key={i} className={lineClass(l, 'dl')} onClick={() => setPicked(l)}>
              <span className="ln">{l.old ?? ''}</span>
              <span className="ln ln-new">{l.new ?? ''}</span>
              <span className="sign">{SIGN[l.kind] ?? ' '}</span>
              <span className="code">{l.text}</span>
            </div>
          )
        )}
      </div>
    )
  }

  return (
    <section className={`inspector${fill ? ' fill' : ''}`} aria-label={`diff di ${path}`}>
      <div className="inspector-head">
        <button className="icon-btn" onClick={onClose} aria-label={fill ? 'torna alla lista' : 'chiudi diff'}>
          {fill ? <ArrowLeft size={16} /> : <X size={16} />}
        </button>
        <div className="file-title">
          <span className="name">{fileNameOf(path)}</span>
          {dir && <span className="dir"><bdi>{dir}</bdi></span>}
        </div>
      </div>
      <div className="inspector-tools">
        <div className="seg" role="group" aria-label="vista del diff">
          <button className={prefs.split || showPreview ? '' : 'on'} onClick={() => { setPreview(false); update({ split: false }) }} aria-pressed={!prefs.split && !showPreview} title="unificata" aria-label="unificata">
            <Rows2 size={14} />
          </button>
          <button className={prefs.split && !showPreview ? 'on' : ''} onClick={() => { setPreview(false); update({ split: true }) }} aria-pressed={prefs.split && !showPreview} title="affiancata" aria-label="affiancata">
            <Columns2 size={14} />
          </button>
          {canPreview && (
            <button className={showPreview ? 'on' : ''} onClick={() => setPreview(true)} aria-pressed={showPreview} title="anteprima del markdown" aria-label="anteprima del markdown">
              <Eye size={14} />
            </button>
          )}
        </div>
        <div className="seg" role="group" aria-label="zoom">
          <button onClick={() => update({ fontSize: prefs.fontSize - 1 })} disabled={prefs.fontSize <= FONT_MIN} aria-label="riduci">
            <ZoomOut size={14} />
          </button>
          <span className="seg-label">{prefs.fontSize}</span>
          <button onClick={() => update({ fontSize: prefs.fontSize + 1 })} disabled={prefs.fontSize >= FONT_MAX} aria-label="ingrandisci">
            <ZoomIn size={14} />
          </button>
        </div>
        <button
          className="btn small primary push-right"
          disabled={!editable || text === null}
          onClick={() => onOpenEditor(line)}
          title={editable ? `apri nell'editor alla riga ${line}` : 'file eliminato: niente da aprire'}
          aria-label={`editor, riga ${line}`}
        >
          <FilePenLine size={14} /> <span className="btn-label">editor ·</span> {line}
        </button>
      </div>
      <div className="diff-scroll">{body}</div>
    </section>
  )
}
