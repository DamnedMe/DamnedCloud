import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder, File as FileIcon, ChevronRight, Save, ArrowLeft, Loader2, Code2, RefreshCw, Eye, FileCode2 } from 'lucide-react'
import { useRemoteStore } from '../lib/store'
import { useNavStore } from '../lib/nav'
import { useBridgeRefresh } from './bridgeHelpers'
import { MarkdownView, isMarkdown } from '../components/MarkdownView'

interface Entry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

function seps(path: string): string {
  return path.includes('\\') ? '\\' : '/'
}

function joinPath(dir: string, name: string): string {
  const s = seps(dir)
  return dir.endsWith(s) ? `${dir}${name}` : `${dir}${s}${name}`
}

const parentOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/** Character offset where `line` (1-based) starts; past the end: the last line. */
function lineOffset(text: string, line: number): number {
  let pos = 0
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf('\n', pos)
    if (nl < 0) break
    pos = nl + 1
  }
  return pos
}

const lineHeight = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight) || 18

export function EditorScreen() {
  const workspace = useRemoteStore((s) => s.workspace)
  const send = useRemoteStore((s) => s.send)
  const editorTarget = useNavStore((s) => s.editorTarget)
  const clearEditorTarget = useNavStore((s) => s.clearEditorTarget)
  const root = workspace?.selectedWorktree || workspace?.repoPath || null
  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** line opened from the diff inspector: scrolled to and highlighted */
  const [mark, setMark] = useState<number | null>(null)
  /** .md only: the rendered text instead of the textarea (as the IDE's "preview") */
  const [preview, setPreview] = useState(false)
  // the textarea only speaks \n: the file's own line ending is restored on save
  const eol = useRef<'\n' | '\r\n'>('\n')
  // a read that lands after the user moved on must not fill the buffer of another file
  const openSeq = useRef(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLPreElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const markRef = useRef(mark)
  markRef.current = mark

  const closeFile = () => {
    openSeq.current++
    setFile(null)
    setContent('')
    setOriginal('')
    setFileLoading(false)
    setMark(null)
    setPreview(false)
  }

  useEffect(() => {
    setDir(root)
    closeFile()
  }, [root])

  // quiet: a refresh pushed by the bridge keeps the error of the last action on screen
  const loadDir = useCallback(async (quiet = false) => {
    if (!dir) return
    setLoading(true)
    if (!quiet) setError(null)
    try {
      const list = await send<Entry[]>('fs.tree', { root: dir })
      list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
      setEntries(list)
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [dir, send])

  useEffect(() => {
    void loadDir()
  }, [loadDir])

  useBridgeRefresh(['fs.changed'], [dir], () => void loadDir(true))

  const openFile = async (path: string, line: number | null = null) => {
    const seq = ++openSeq.current
    setFile(path)
    setError(null)
    setContent('')
    setOriginal('')
    setMark(line)
    // opened at a line (from the diff): the source, where that line is
    setPreview(false)
    setFileLoading(true)
    try {
      const res = await send<{ content: string }>('fs.read', { file: path })
      if (seq !== openSeq.current) return
      eol.current = res.content.includes('\r\n') ? '\r\n' : '\n'
      const text = res.content.replace(/\r\n/g, '\n')
      setContent(text)
      setOriginal(text)
    } catch (e) {
      if (seq !== openSeq.current) return
      // never an editable empty buffer: saving it would blank the file on the desktop
      setFile(null)
      setError((e as Error).message)
    } finally {
      if (seq === openSeq.current) setFileLoading(false)
    }
  }

  // "editor" in the diff inspector (this screen mounts with the tab, so no buffer to lose):
  // after the root effect above, so its folder wins
  useEffect(() => {
    if (!editorTarget || !root) return
    clearEditorTarget()
    setDir(parentOf(editorTarget.file) || root)
    void openFile(editorTarget.file, editorTarget.line)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorTarget, root])

  /** Gutter and highlight band follow the textarea scroll (no re-render). */
  const syncScroll = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop
    if (bandRef.current && markRef.current) {
      bandRef.current.style.transform = `translateY(${(markRef.current - 1) * lineHeight(ta) - ta.scrollTop}px)`
    }
  }, [])

  // the file just loaded: scroll the marked line to the upper third, caret at its start
  useEffect(() => {
    const ta = taRef.current
    if (!ta || fileLoading || !mark) return
    ta.scrollTop = Math.max(0, (mark - 1) * lineHeight(ta) - ta.clientHeight / 3)
    const pos = lineOffset(ta.value, mark)
    ta.setSelectionRange(pos, pos)
    syncScroll()
  }, [file, fileLoading, mark, syncScroll])

  const save = async () => {
    if (!file || fileLoading) return
    setError(null)
    try {
      // ponytail: a file with mixed endings comes back all CRLF
      await send('editor.save', { file, content: eol.current === '\r\n' ? content.replace(/\n/g, '\r\n') : content })
      setOriginal(content)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const lineCount = useMemo(() => content.split('\n').length, [content])
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount])

  const crumbs = useMemo(() => {
    if (!dir || !root) return []
    const s = seps(root)
    const rel = dir.slice(root.length).split(s).filter(Boolean)
    const out: { label: string; path: string }[] = [{ label: 'root', path: root }]
    let acc = root
    for (const part of rel) {
      acc = joinPath(acc, part)
      out.push({ label: part, path: acc })
    }
    return out
  }, [dir, root])

  if (!root) {
    return <div className="empty-state">Apri un repository dalla sezione Worktree.</div>
  }

  const dirty = content !== original
  const markdown = isMarkdown(file)
  const showPreview = markdown && preview && !fileLoading

  return (
    <>
      <div className="screen-head">
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb">
              {i > 0 && <ChevronRight size={12} color="var(--text-muted)" />}
              <button onClick={() => { setDir(c.path); closeFile() }}>{c.label}</button>
            </span>
          ))}
        </div>
        <button className="btn small" onClick={() => void loadDir()} disabled={loading} aria-label="aggiorna">
          {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {file ? (
        <div className="card editor-card">
          <div className="row between">
            <div className="row" style={{ minWidth: 0 }}>
              <button className="icon-btn" onClick={closeFile} aria-label="chiudi file">
                <ArrowLeft size={15} />
              </button>
              {fileLoading && <Loader2 size={13} className="spinner" />}
              <span className="file-title">
                <span className="name">{dirty ? '● ' : ''}{file.slice(parentOf(file).length + 1)}</span>
                {mark && <span className="dir">riga {mark}</span>}
              </span>
            </div>
            <div className="row editor-actions">
              {markdown && (
                <button
                  className={`btn small${preview ? ' on' : ''}`}
                  onClick={() => setPreview((p) => !p)}
                  disabled={fileLoading}
                  aria-pressed={preview}
                  aria-label={preview ? 'mostra il sorgente' : 'anteprima del markdown'}
                  title={preview ? 'mostra il sorgente' : 'anteprima del markdown'}
                >
                  {preview ? <FileCode2 size={13} /> : <Eye size={13} />}
                  <span className="btn-label">{preview ? 'sorgente' : 'anteprima'}</span>
                </button>
              )}
              <button className="btn small primary" onClick={() => void save()} disabled={fileLoading || !dirty} aria-label="salva" title="salva">
                <Save size={13} /> <span className="btn-label">salva</span>
              </button>
            </div>
          </div>
          {showPreview ? (
            <MarkdownView content={content} className="md-editor" />
          ) : (
            <div className="code-wrap">
              <pre ref={gutterRef} className="gutter" aria-hidden>{gutter}</pre>
              {mark && !fileLoading && <div ref={bandRef} className="line-band" />}
              <textarea
                ref={taRef}
                className="code"
                value={content}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                disabled={fileLoading}
                placeholder={fileLoading ? 'caricamento…' : undefined}
                onScroll={syncScroll}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="list">
          {dir !== root && (
            <button className="list-item" onClick={() => { setDir(parentOf(dir!) || root) }}>
              <ArrowLeft size={15} /> ..
            </button>
          )}
          {entries.map((entry) => (
            <button
              key={entry.name}
              className="list-item"
              onClick={() => (entry.isDirectory ? setDir(joinPath(dir!, entry.name)) : void openFile(joinPath(dir!, entry.name)))}
            >
              {entry.isDirectory ? <Folder size={15} color="var(--accent)" /> : <FileIcon size={15} color="var(--text-muted)" />}
              <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 12.5 }}>{entry.name}</span>
            </button>
          ))}
          {!loading && entries.length === 0 && (
            <div className="muted row" style={{ justifyContent: 'center', padding: 16 }}>
              <Code2 size={14} /> cartella vuota
            </div>
          )}
        </div>
      )}
    </>
  )
}
