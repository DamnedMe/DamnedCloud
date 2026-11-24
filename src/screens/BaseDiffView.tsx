import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, GitCompare, Loader2, RefreshCw, X } from 'lucide-react'
import { useRemoteStore } from '../lib/store'
import { RemoteError } from '../lib/connection'
import { useNavStore } from '../lib/nav'
import { unifiedDiff } from '../lib/diff'
import { dirOf, fileNameOf, groupChanges } from '../shared/changeGroups'
import type { WorktreeBaseDiff, WorktreeBaseDiffFile } from '../shared/remote/protocol'
import { DiffInspector } from './DiffInspector'
import { GROUP_LABELS, LANDSCAPE_PHONE, absPath, useMedia } from './changesShared'

const STATUS: Record<WorktreeBaseDiffFile['status'], { ch: string; color: string }> = {
  A: { ch: 'A', color: 'var(--success)' },
  D: { ch: 'D', color: 'var(--error)' },
  M: { ch: 'M', color: 'var(--warning)' },
  R: { ch: 'R', color: 'var(--warning)' }
}

interface Props {
  /** the selected worktree (never the main checkout) */
  worktreePath: string
  /** back to the pending changes */
  onClose: () => void
}

/**
 * The desktop's "diff con develop", read-only: every change of the worktree's branch since it left
 * its base (develop, or the parent of a stacked branch), commits pushed or not plus the pending ones,
 * one row per file, as the PR shows them. The old side is the file at the merge base, the new one
 * the file on disk: the phone compares them itself, as the IDE's DiffViewer does.
 */
export function BaseDiffView({ worktreePath, onClose }: Props) {
  const send = useRemoteStore((s) => s.send)
  const openInEditor = useNavStore((s) => s.openInEditor)
  const [data, setData] = useState<WorktreeBaseDiff | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const diffFor = useRef<string | null>(null)
  const request = useRef(0) // a late answer for another worktree is dropped
  const inspectorRef = useRef<HTMLDivElement>(null)
  const landscape = useMedia(LANDSCAPE_PHONE)

  const groups = useMemo(() => groupChanges(data?.files ?? []), [data])
  const selectedFile = data?.files.find((f) => f.path === selected) ?? null

  const openDiff = useCallback(async (base: WorktreeBaseDiff, file: WorktreeBaseDiffFile) => {
    diffFor.current = file.path
    setSelected(file.path)
    setDiff(null)
    try {
      const [original, modified] = await Promise.all([
        file.status === 'A'
          ? ''
          : send<{ content: string }>('git.file', { repoPath: worktreePath, file: file.oldPath ?? file.path, ref: base.mergeBase }).then((r) => r.content),
        file.status === 'D'
          ? ''
          : send<{ content: string }>('fs.read', { file: absPath(worktreePath, file.path) }).then((r) => r.content)
      ])
      const text = unifiedDiff(original, modified)
      const renamed = file.oldPath ? `rinominato da ${file.oldPath}` : ''
      if (diffFor.current === file.path) setDiff(text || renamed)
    } catch (e) {
      if (diffFor.current === file.path) setDiff(`// ${(e as Error).message}`)
    }
  }, [send, worktreePath])

  const closeDiff = () => {
    diffFor.current = null
    setSelected(null)
    setDiff(null)
  }

  // refreshed on open and by the button, as on the desktop
  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const next = await send<WorktreeBaseDiff>('worktree.baseDiff', { repoPath: worktreePath })
      if (id !== request.current) return
      setData(next)
      const keep = diffFor.current ? next.files.find((f) => f.path === diffFor.current) : undefined
      if (keep) void openDiff(next, keep)
      else closeDiff()
    } catch (e) {
      if (id !== request.current) return
      setError(e instanceof RemoteError && e.code === 'unknown_command'
        ? 'Aggiorna DamnedIDE sul desktop: questa versione non porta il diff con develop sul telefono'
        : (e as Error).message)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [send, worktreePath, openDiff])

  useEffect(() => {
    void load()
  }, [load])

  // portrait: the inspector sits under the list, bring it into view once it opens
  useEffect(() => {
    if (selected && !landscape) inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected, landscape])

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const inspector = selectedFile && (
    <div ref={inspectorRef} className={landscape ? 'inspector-wrap fill' : 'inspector-wrap'}>
      <DiffInspector
        path={selectedFile.path}
        text={diff}
        editable={selectedFile.status !== 'D'}
        file={absPath(worktreePath, selectedFile.path)}
        fill={landscape}
        onClose={closeDiff}
        onOpenEditor={(line) => openInEditor(absPath(worktreePath, selectedFile.path), line)}
      />
    </div>
  )

  // landscape phone: straight to the inspector of the selected file
  if (landscape && inspector) return inspector

  const base = data?.base.replace(/^origin\//, '') ?? 'develop'

  return (
    <>
      <div className="screen-head">
        <div className="row head-title">
          <GitCompare size={16} color="var(--accent)" />
          <strong>Diff con {base}</strong>
          {data && <span className="badge">{data.files.length}</span>}
        </div>
        <div className="row head-actions">
          <button className="btn small" onClick={() => void load()} disabled={loading} aria-label="aggiorna">
            {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
          </button>
          <button className="btn small" onClick={onClose} title="torna alle modifiche in sospeso" aria-label="chiudi">
            <X size={13} /> <span className="btn-label">chiudi</span>
          </button>
        </div>
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>
        Tutte le modifiche del branch da quando è partito da {data?.base ?? base}: commit, anche già pushati, e modifiche in sospeso insieme, come nella PR. Sola lettura.
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="changes-layout">
        <div className="changes-list">
          {groups.length > 0 && (
            <section className="zone">
              <div className="zone-head" style={{ color: 'var(--accent)' }}>
                modifiche del branch
                <span className="count">{data?.files.length}</span>
              </div>
              {groups.map((group) => {
                const open = !collapsed.has(group.id)
                return (
                  <div key={group.id} className="group">
                    <button className="group-head" onClick={() => toggleGroup(group.id)} aria-expanded={open}>
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="label">{GROUP_LABELS[group.label] ?? group.label}</span>
                      <span className="count">{group.files.length}</span>
                    </button>
                    {open && group.files.map((file) => {
                      const { ch, color } = STATUS[file.status]
                      const dir = dirOf(file.path)
                      const active = selected === file.path
                      return (
                        <div
                          key={file.path}
                          role="button"
                          tabIndex={0}
                          aria-current={active || undefined}
                          className={`change-row${active ? ' active' : ''}`}
                          title={file.oldPath ? `rinominato da ${file.oldPath}` : undefined}
                          onClick={() => data && void openDiff(data, file)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                            e.preventDefault()
                            if (data) void openDiff(data, file)
                          }}
                        >
                          <span className="status" style={{ color }}>{ch}</span>
                          <span className="file-title">
                            <span className="name">{fileNameOf(file.path)}</span>
                            {dir && <span className="dir"><bdi>{dir}</bdi></span>}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </section>
          )}
          {!loading && data && data.files.length === 0 && <div className="empty-state">nessuna differenza con {base}</div>}
        </div>

        {inspector}
      </div>
    </>
  )
}
