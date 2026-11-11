import { useCallback, useEffect, useState } from 'react'
import { Boxes, RefreshCw, FolderOpen, GitBranch, Check, Loader2, Trash2 } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'
import { isDeclined, samePath, useBridgeRefresh } from './bridgeHelpers'

/** WorktreeService.remove answers a refusal or a locked folder instead of throwing. */
interface RemoveResult {
  ok: boolean
  warning?: string
  error?: string
}

interface WorktreeEntry {
  path: string
  head: string
  branch: string
  bare: boolean
  detached: boolean
}

export function WorktreesScreen() {
  const workspace = useRemoteStore((s) => s.workspace)
  const send = useRemoteStore((s) => s.send)
  const [repoInput, setRepoInput] = useState('')
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const repoPath = workspace?.selectedWorktree || workspace?.repoPath || null

  // quiet: a refresh pushed by the bridge keeps the error of the last action on screen
  const load = useCallback(async (quiet = false) => {
    const target = workspace?.repoPath
    if (!target) return
    setLoading(true)
    if (!quiet) setError(null)
    try {
      setWorktrees(await send<WorktreeEntry[]>('worktree.list', { repoPath: target }))
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [send, workspace?.repoPath])

  useEffect(() => {
    void load()
  }, [load])

  // file edits do not change the worktree list: git events only
  useBridgeRefresh(['git.changed'], [workspace?.repoPath], () => void load(true))

  const remove = async (entry: WorktreeEntry) => {
    const mainRepo = workspace?.repoPath
    if (!mainRepo) return
    setRemoving(entry.path)
    setNotice(null)
    try {
      // the bridge asks to confirm, then refuses the main checkout and the open folder itself
      const res = await sendConfirmed<RemoveResult>('worktree.remove', { repoPath: mainRepo, worktreePath: entry.path })
      await load()
      if (res && !res.ok) setError(res.error || 'worktree non rimosso')
      else if (res?.warning) setNotice(res.warning)
    } catch (e) {
      if (!isDeclined(e)) setError((e as Error).message)
    } finally {
      setRemoving(null)
    }
  }

  const openRepo = async () => {
    setError(null)
    try {
      await send('workspace.setRepo', { repoPath: repoInput.trim() })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const select = async (entry: WorktreeEntry) => {
    setError(null)
    try {
      await send('workspace.openWorktree', { path: entry.path })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      <div className="card">
        <div className="row between">
          <div className="row">
            <FolderOpen size={16} color="var(--accent)" />
            <strong>Repository</strong>
          </div>
          <button className="btn small" onClick={() => void load()} disabled={loading || !workspace?.repoPath}>
            {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
          </button>
        </div>
        <div className="muted mono" style={{ wordBreak: 'break-all' }}>
          {workspace?.repoPath || 'nessun repository aperto sul desktop'}
        </div>
        {!workspace?.repoPath && (
          <div className="row">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="C:\\percorso\\del\\repo"
              style={{ fontSize: 12.5 }}
            />
            <button className="btn small primary" onClick={() => void openRepo()} disabled={!repoInput.trim()}>
              apri
            </button>
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="worktrees-notice">{notice}</div>}

      <div className="list">
        {worktrees.map((w, index) => {
          const active = repoPath === w.path
          // git lists the main checkout first; the open worktree would vanish under the desktop
          const removable = index > 0 && !w.bare && !samePath(w.path, repoPath) && !samePath(w.path, workspace?.repoPath)
          return (
            // a div with button semantics: a real <button> cannot contain the remove button
            <div
              key={w.path}
              role="button"
              tabIndex={0}
              aria-current={active || undefined}
              className={`list-item${active ? ' active' : ''}`}
              onClick={() => void select(w)}
              onKeyDown={(e) => {
                // keys pressed on the nested remove button are its own
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                void select(w)
              }}
            >
              <GitBranch size={15} color={active ? 'var(--accent)' : 'var(--text-muted)'} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row between">
                  <strong style={{ fontSize: 13 }}>{w.branch || w.head.slice(0, 8)}</strong>
                  {active && <Check size={14} color="var(--accent)" />}
                </div>
                <div className="muted" style={{ wordBreak: 'break-all', fontSize: 11 }}>
                  {w.path}
                </div>
              </div>
              {w.detached && <span className="badge">detached</span>}
              {removable && (
                <button
                  className="btn small danger"
                  title="rimuovi worktree"
                  disabled={removing !== null}
                  onClick={(e) => { e.stopPropagation(); void remove(w) }}
                >
                  {removing === w.path ? <Loader2 size={13} className="spinner" /> : <Trash2 size={13} />}
                </button>
              )}
            </div>
          )
        })}
        {!loading && worktrees.length === 0 && workspace?.repoPath && (
          <div className="muted" style={{ textAlign: 'center', padding: 16 }}>
            nessun worktree
          </div>
        )}
      </div>

      <div className="muted row">
        <Boxes size={14} /> {worktrees.length} worktree
      </div>
    </>
  )
}
