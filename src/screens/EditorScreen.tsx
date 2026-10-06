import { useCallback, useEffect, useMemo, useState } from 'react'
import { Folder, File as FileIcon, ChevronRight, Save, ArrowLeft, Loader2, Code2, RefreshCw } from 'lucide-react'
import { useRemoteStore } from '../lib/store'

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

export function EditorScreen() {
  const workspace = useRemoteStore((s) => s.workspace)
  const send = useRemoteStore((s) => s.send)
  const root = workspace?.selectedWorktree || workspace?.repoPath || null
  const [dir, setDir] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [file, setFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDir(root)
    setFile(null)
  }, [root])

  const loadDir = useCallback(async () => {
    if (!dir) return
    setLoading(true)
    setError(null)
    try {
      const list = await send<Entry[]>('fs.tree', { root: dir })
      list.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
      setEntries(list)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [dir, send])

  useEffect(() => {
    void loadDir()
  }, [loadDir])

  const openFile = async (path: string) => {
    setFile(path)
    setError(null)
    setContent('caricamento…')
    try {
      const res = await send<{ content: string }>('fs.read', { file: path })
      setContent(res.content)
      setOriginal(res.content)
    } catch (e) {
      setContent('')
      setError((e as Error).message)
    }
  }

  const save = async () => {
    if (!file) return
    setError(null)
    try {
      await send('editor.save', { file, content })
      setOriginal(content)
    } catch (e) {
      setError((e as Error).message)
    }
  }

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
    return <div className="muted" style={{ textAlign: 'center', padding: 24 }}>Apri un repository dalla sezione Worktree.</div>
  }

  return (
    <>
      <div className="row between">
        <div className="row" style={{ minWidth: 0, flex: 1, overflowX: 'auto' }}>
          {crumbs.map((c, i) => (
            <span key={c.path} className="row" style={{ gap: 2, flexShrink: 0 }}>
              {i > 0 && <ChevronRight size={12} color="var(--text-muted)" />}
              <button
                className="btn small"
                style={{ border: 'none', background: 'none', padding: '4px 6px' }}
                onClick={() => { setDir(c.path); setFile(null) }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </div>
        <button className="btn small" onClick={() => void loadDir()} disabled={loading}>
          {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {file ? (
        <div className="card">
          <div className="row between">
            <div className="row" style={{ minWidth: 0 }}>
              <button className="btn small" onClick={() => { setFile(null); setContent(''); setOriginal('') }}>
                <ArrowLeft size={13} />
              </button>
              <span className="muted mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{file}</span>
            </div>
            <button className="btn small primary" onClick={() => void save()} disabled={content === original}>
              <Save size={13} /> salva
            </button>
          </div>
          <textarea className="code" value={content} spellCheck={false} onChange={(e) => setContent(e.target.value)} />
        </div>
      ) : (
        <div className="list">
          {dir !== root && (
            <button className="list-item" onClick={() => { setDir(dir!.replace(/[\\/][^\\/]*$/, '') || root) }}>
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
