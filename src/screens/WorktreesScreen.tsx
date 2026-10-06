import { useCallback, useEffect, useState } from 'react'
import { Boxes, RefreshCw, FolderOpen, GitBranch, Check, Loader2 } from 'lucide-react'
import { useRemoteStore } from '../lib/store'

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
  const [error, setError] = useState<string | null>(null)

  const repoPath = workspace?.selectedWorktree || workspace?.repoPath || null

  const load = useCallback(async () => {
    const target = workspace?.repoPath
    if (!target) return
    setLoading(true)
    setError(null)
    try {
      setWorktrees(await send<WorktreeEntry[]>('worktree.list', { repoPath: target }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [send, workspace?.repoPath])

  useEffect(() => {
    void load()
  }, [load])

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

      <div className="list">
        {worktrees.map((w) => {
          const active = repoPath === w.path
          return (
            <button key={w.path} className={`list-item${active ? ' active' : ''}`} onClick={() => void select(w)}>
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
            </button>
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
