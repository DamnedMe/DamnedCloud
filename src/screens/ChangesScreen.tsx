import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, FileDiff, Plus, Minus, Undo2, Loader2, Send } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'

interface PorcelainFile {
  path: string
  changeType: string
}

interface Porcelain {
  staged: PorcelainFile[]
  unstaged: PorcelainFile[]
  unmerged: PorcelainFile[]
}

interface Row {
  path: string
  status: string
  staged: boolean
  unstaged: boolean
  conflict: boolean
}

function buildRows(p: Porcelain): Row[] {
  const map = new Map<string, Row>()
  const ensure = (path: string): Row => {
    let row = map.get(path)
    if (!row) {
      row = { path, status: '', staged: false, unstaged: false, conflict: false }
      map.set(path, row)
    }
    return row
  }
  for (const f of p.staged) {
    const row = ensure(f.path)
    row.staged = true
    row.status = f.changeType
  }
  for (const f of p.unstaged) {
    const row = ensure(f.path)
    row.unstaged = true
    row.status = row.status || f.changeType
  }
  for (const f of p.unmerged) {
    const row = ensure(f.path)
    row.conflict = true
    row.status = 'U'
  }
  return [...map.values()]
}

function DiffView({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split('\n').map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add'
          : line.startsWith('-') && !line.startsWith('---') ? 'del'
            : line.startsWith('@@') ? 'hunk' : ''
        return (
          <div key={i} className={cls ? `diff-line ${cls}` : 'diff-line'}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

export function ChangesScreen() {
  const workspace = useRemoteStore((s) => s.workspace)
  const send = useRemoteStore((s) => s.send)
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoPath = workspace?.selectedWorktree || workspace?.repoPath || null

  const load = useCallback(async () => {
    if (!repoPath) return
    setLoading(true)
    setError(null)
    try {
      const porcelain = await send<Porcelain>('git.porcelain', { repoPath })
      setRows(buildRows(porcelain))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [send, repoPath])

  useEffect(() => {
    void load()
  }, [load])

  const openDiff = async (row: Row) => {
    setSelected(row.path)
    setDiff('caricamento…')
    try {
      setDiff(await send<string>('git.diff', { repoPath, file: row.path, staged: row.staged && !row.unstaged }))
    } catch (e) {
      setDiff(`// ${(e as Error).message}`)
    }
  }

  const stageToggle = async (row: Row) => {
    try {
      if (row.staged && !row.unstaged) await send('git.unstage', { repoPath, files: [row.path] })
      else await send('git.stage', { repoPath, files: [row.path] })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const discard = async (row: Row) => {
    try {
      await sendConfirmed('git.discard', { repoPath, file: row.path, untracked: !row.staged })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const commit = async () => {
    if (!message.trim()) return
    try {
      await send('git.commit', { repoPath, message })
      setMessage('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!repoPath) {
    return <div className="muted" style={{ textAlign: 'center', padding: 24 }}>Apri un repository dalla sezione Worktree.</div>
  }

  return (
    <>
      <div className="row between">
        <div className="row">
          <FileDiff size={16} color="var(--accent)" />
          <strong>Modifiche</strong>
          <span className="badge">{rows.length}</span>
        </div>
        <button className="btn small" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="list">
        {rows.map((row) => (
          <div key={row.path} className={`list-item${selected === row.path ? ' active' : ''}`} onClick={() => void openDiff(row)}>
            <span className="badge" style={{ color: row.conflict ? 'var(--error)' : row.staged ? 'var(--success)' : 'var(--warning)' }}>
              {row.status || (row.staged ? 'S' : 'M')}
            </span>
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 12 }}>{row.path}</span>
            <button className="btn small" onClick={(e) => { e.stopPropagation(); void stageToggle(row) }} title={row.staged && !row.unstaged ? 'unstage' : 'stage'}>
              {row.staged && !row.unstaged ? <Minus size={13} /> : <Plus size={13} />}
            </button>
            <button className="btn small danger" onClick={(e) => { e.stopPropagation(); void discard(row) }} title="scarta">
              <Undo2 size={13} />
            </button>
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 16 }}>nessuna modifica</div>}
      </div>

      {selected && diff !== null && (
        <div className="card">
          <div className="muted mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{selected}</div>
          <DiffView text={diff} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <label className="field">
            Messaggio di commit
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="#123 : descrizione" />
          </label>
          <button className="btn primary" onClick={() => void commit()} disabled={!message.trim()}>
            <Send size={15} /> commit
          </button>
        </div>
      )}
    </>
  )
}
