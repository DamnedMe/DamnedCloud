import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, FileDiff, Plus, Minus, Undo2, Loader2, Send, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'
import { isDeclined, useBridgeRefresh } from './bridgeHelpers'

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
  /** new file git does not track yet (porcelain "??"): discarding it deletes it from disk */
  untracked: boolean
}

function buildRows(p: Porcelain): Row[] {
  const map = new Map<string, Row>()
  const ensure = (path: string): Row => {
    let row = map.get(path)
    if (!row) {
      row = { path, status: '', staged: false, unstaged: false, conflict: false, untracked: false }
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
    // GitService.porcelain reports "??" as an unstaged 'add'; a staged "A" lands in staged first
    row.untracked = f.changeType === 'add' && !row.staged
    row.status = row.status || f.changeType
  }
  for (const f of p.unmerged) {
    const row = ensure(f.path)
    row.conflict = true
    row.status = 'U'
  }
  return [...map.values()]
}

const MAX_NEW_FILE_LINES = 2000

/** An untracked file has no git diff: show its whole content as added lines. */
function newFileDiff(content: string): string {
  if (content.includes('\0')) return '// file binario'
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const shown = lines.slice(0, MAX_NEW_FILE_LINES).map((line) => `+${line}`)
  if (lines.length > MAX_NEW_FILE_LINES) shown.push(`… altre ${lines.length - MAX_NEW_FILE_LINES} righe`)
  return [`@@ nuovo file · ${lines.length} righe @@`, ...shown].join('\n')
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
  const [syncing, setSyncing] = useState<'pull' | 'push' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const diffFor = useRef<string | null>(null)

  const repoPath = workspace?.selectedWorktree || workspace?.repoPath || null

  // quiet: a refresh pushed by the bridge keeps the error of the last action on screen
  const load = useCallback(async (quiet = false) => {
    if (!repoPath) return
    setLoading(true)
    if (!quiet) setError(null)
    try {
      const porcelain = await send<Porcelain>('git.porcelain', { repoPath })
      const next = buildRows(porcelain)
      setRows(next)
      setSelected((path) => (path && next.some((r) => r.path === path) ? path : null))
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [send, repoPath])

  useEffect(() => {
    void load()
  }, [load])

  useBridgeRefresh(['git.changed', 'fs.changed'], [repoPath, workspace?.repoPath], () => void load(true))

  const openDiff = async (row: Row) => {
    diffFor.current = row.path
    setSelected(row.path)
    setDiff('caricamento…')
    try {
      // ponytail: the bridge resolve()s the path, so the porcelain '/' on a Windows root is fine
      const text = row.untracked
        ? newFileDiff((await send<{ content: string }>('fs.read', { file: `${repoPath!.replace(/[\\/]+$/, '')}/${row.path}` })).content)
        : await send<string>('git.diff', { repoPath, file: row.path, staged: row.staged && !row.unstaged })
      if (diffFor.current === row.path) setDiff(text)
    } catch (e) {
      if (diffFor.current === row.path) setDiff(`// ${(e as Error).message}`)
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
      // untracked makes GitService.discardChanges rm the path: only for a new file, a tracked
      // one is restored with checkout (staged: reset first, so both sides are undone)
      await sendConfirmed('git.discard', { repoPath, file: row.path, staged: row.staged, untracked: row.untracked })
      await load()
    } catch (e) {
      if (!isDeclined(e)) setError((e as Error).message)
    }
  }

  const sync = async (kind: 'pull' | 'push') => {
    setSyncing(kind)
    setError(null)
    setNotice(null)
    try {
      // push through sendConfirmed: a bridge that asks to confirm it gets the dialog
      if (kind === 'push') await sendConfirmed('git.push', { repoPath })
      else await send('git.pull', { repoPath })
      await load()
      setNotice(kind === 'push' ? 'push completato' : 'pull completato')
    } catch (e) {
      if (!isDeclined(e)) setError((e as Error).message)
    } finally {
      setSyncing(null)
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
        <div className="row">
          <button className="btn small" onClick={() => void sync('pull')} disabled={syncing !== null} title="pull">
            {syncing === 'pull' ? <Loader2 size={13} className="spinner" /> : <ArrowDownToLine size={13} />} pull
          </button>
          <button className="btn small" onClick={() => void sync('push')} disabled={syncing !== null} title="push">
            {syncing === 'push' ? <Loader2 size={13} className="spinner" /> : <ArrowUpFromLine size={13} />} push
          </button>
          <button className="btn small" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="changes-notice">{notice}</div>}

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
            {/* a conflict is solved by editing and staging the file, not by discarding it */}
            {!row.conflict && (
              <button className="btn small danger" onClick={(e) => { e.stopPropagation(); void discard(row) }} title={row.untracked ? 'elimina file nuovo' : 'scarta'}>
                <Undo2 size={13} />
              </button>
            )}
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
