import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, FileDiff, Plus, Minus, Undo2, Loader2, Send, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronRight, GitCompare } from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'
import { useNavStore } from '../lib/nav'
import { isDeclined, samePath, useBridgeRefresh } from './bridgeHelpers'
import { dirOf, fileNameOf, groupChanges } from '../shared/changeGroups'
import { DiffInspector } from './DiffInspector'
import { BaseDiffView } from './BaseDiffView'
import { GROUP_LABELS, LANDSCAPE_PHONE, absPath, useMedia } from './changesShared'

interface PorcelainFile {
  path: string
  changeType: string
}

interface Porcelain {
  staged: PorcelainFile[]
  unstaged: PorcelainFile[]
  unmerged: PorcelainFile[]
}

type Zone = 'conflict' | 'staged' | 'unstaged'

/** One row per zone, as the IDE lists them: a file staged and modified again shows twice. */
interface Row {
  path: string
  /** 'add' | 'delete' | 'edit' (GitService.porcelain); a conflict: its XY code */
  changeType: string
  zone: Zone
  /** new file git does not track yet (porcelain "??"): discarding it deletes it from disk */
  untracked: boolean
}

const ZONES: { id: Zone; label: string; color: string }[] = [
  { id: 'conflict', label: 'conflitti', color: 'var(--error)' },
  { id: 'staged', label: 'modifiche in stage', color: 'var(--success)' },
  { id: 'unstaged', label: 'modifiche', color: 'var(--warning)' }
]

const keyOf = (row: Row) => `${row.zone}:${row.path}`

function buildRows(p: Porcelain): Row[] {
  const staged = new Set(p.staged.map((f) => f.path))
  return [
    ...p.unmerged.map((f): Row => ({ path: f.path, changeType: f.changeType, zone: 'conflict', untracked: false })),
    ...p.staged.map((f): Row => ({ path: f.path, changeType: f.changeType, zone: 'staged', untracked: false })),
    // GitService.porcelain reports "??" as an unstaged 'add'; a staged "A" lands in staged first
    ...p.unstaged.map((f): Row => ({ path: f.path, changeType: f.changeType, zone: 'unstaged', untracked: f.changeType === 'add' && !staged.has(f.path) }))
  ]
}

function statusLetter(row: Row): { ch: string; color: string } {
  if (row.zone === 'conflict') return { ch: 'U', color: 'var(--error)' }
  if (row.changeType === 'add') return { ch: 'A', color: 'var(--success)' }
  if (row.changeType === 'delete') return { ch: 'D', color: 'var(--error)' }
  return { ch: 'M', color: 'var(--warning)' }
}

const MAX_NEW_FILE_LINES = 2000

/** An untracked file has no git diff: show its whole content as added lines. */
function newFileDiff(content: string): string {
  if (content.includes('\0')) return '// file binario'
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const shown = lines.slice(0, MAX_NEW_FILE_LINES).map((line) => `+${line}`)
  if (lines.length > MAX_NEW_FILE_LINES) shown.push(`… altre ${lines.length - MAX_NEW_FILE_LINES} righe`)
  return [`@@ -0,0 +1,${lines.length} @@ nuovo file`, ...shown].join('\n')
}

export function ChangesScreen() {
  const workspace = useRemoteStore((s) => s.workspace)
  const send = useRemoteStore((s) => s.send)
  const openInEditor = useNavStore((s) => s.openInEditor)
  const [rows, setRows] = useState<Row[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState<'pull' | 'push' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const diffFor = useRef<string | null>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const landscape = useMedia(LANDSCAPE_PHONE)

  const repoPath = workspace?.selectedWorktree || workspace?.repoPath || null
  // "diff con develop" as on the desktop: a linked worktree, not the main checkout
  const comparable = !!workspace?.selectedWorktree && !samePath(workspace.selectedWorktree, workspace.repoPath)
  /** the worktree whose comparison with its base replaces the pending changes */
  const [comparing, setComparing] = useState<string | null>(null)
  const selectedRow = rows.find((r) => keyOf(r) === selected) ?? null
  const zones = useMemo(
    () => ZONES.map((z) => ({ ...z, groups: groupChanges(rows.filter((r) => r.zone === z.id)) })).filter((z) => z.groups.length > 0),
    [rows]
  )
  const stagedCount = rows.filter((r) => r.zone === 'staged').length

  // quiet: a refresh pushed by the bridge keeps the error of the last action on screen
  const load = useCallback(async (quiet = false) => {
    if (!repoPath) return
    setLoading(true)
    if (!quiet) setError(null)
    try {
      const porcelain = await send<Porcelain>('git.porcelain', { repoPath })
      const next = buildRows(porcelain)
      setRows(next)
      setSelected((key) => (key && next.some((r) => keyOf(r) === key) ? key : null))
    } catch (e) {
      if (!quiet) setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [send, repoPath])

  useEffect(() => {
    void load()
  }, [load])

  // another worktree selected: its Changes show the pending changes again
  useEffect(() => {
    if (comparing && !samePath(comparing, repoPath)) setComparing(null)
  }, [comparing, repoPath])

  useBridgeRefresh(['git.changed', 'fs.changed'], [repoPath, workspace?.repoPath], () => void load(true))

  const openDiff = async (row: Row) => {
    const key = keyOf(row)
    diffFor.current = key
    setSelected(key)
    setDiff(null)
    try {
      // ponytail: the bridge resolve()s the path, so the porcelain '/' on a Windows root is fine
      const text = row.untracked
        ? newFileDiff((await send<{ content: string }>('fs.read', { file: absPath(repoPath!, row.path) })).content)
        : await send<string>('git.diff', { repoPath, file: row.path, staged: row.zone === 'staged' })
      if (diffFor.current === key) setDiff(text)
    } catch (e) {
      if (diffFor.current === key) setDiff(`// ${(e as Error).message}`)
    }
  }

  // portrait: the inspector sits under the list, bring it into view once it opens
  useEffect(() => {
    if (selected && !landscape) inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected, landscape])

  const closeDiff = () => {
    diffFor.current = null
    setSelected(null)
    setDiff(null)
  }

  const stageToggle = async (row: Row) => {
    try {
      await send(row.zone === 'staged' ? 'git.unstage' : 'git.stage', { repoPath, files: [row.path] })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const discard = async (row: Row) => {
    try {
      // untracked makes GitService.discardChanges rm the path: only for a new file, a tracked
      // one is restored with checkout (a staged row: reset first, so both sides are undone)
      await sendConfirmed('git.discard', { repoPath, file: row.path, staged: row.zone === 'staged', untracked: row.untracked })
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

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  if (!repoPath) {
    return <div className="empty-state">Apri un repository dalla sezione Worktree.</div>
  }

  if (comparing && comparable && samePath(comparing, repoPath)) {
    return <BaseDiffView worktreePath={comparing} onClose={() => setComparing(null)} />
  }

  const inspector = selectedRow && (
    <div ref={inspectorRef} className={landscape ? 'inspector-wrap fill' : 'inspector-wrap'}>
      <DiffInspector
        path={selectedRow.path}
        text={diff}
        // a nested repository (trailing '/') or a deleted file has nothing to open
        editable={selectedRow.changeType !== 'delete' && !selectedRow.path.endsWith('/')}
        fill={landscape}
        onClose={closeDiff}
        onOpenEditor={(line) => openInEditor(absPath(repoPath, selectedRow.path), line)}
      />
    </div>
  )

  // landscape phone: straight to the inspector of the selected change
  if (landscape && inspector) return inspector

  return (
    <>
      <div className="screen-head">
        <div className="row head-title">
          <FileDiff size={16} color="var(--accent)" />
          <strong>Modifiche</strong>
          <span className="badge">{rows.length}</span>
        </div>
        <div className="row head-actions">
          {comparable && (
            <button className="btn small" onClick={() => setComparing(repoPath)} title="diff con develop: commit e modifiche del branch, come nella PR" aria-label="diff con develop">
              <GitCompare size={13} /> <span className="btn-label-narrow">develop</span>
            </button>
          )}
          <button className="btn small" onClick={() => void sync('pull')} disabled={syncing !== null} title="pull" aria-label="pull">
            {syncing === 'pull' ? <Loader2 size={13} className="spinner" /> : <ArrowDownToLine size={13} />} <span className="btn-label">pull</span>
          </button>
          <button className="btn small" onClick={() => void sync('push')} disabled={syncing !== null} title="push" aria-label="push">
            {syncing === 'push' ? <Loader2 size={13} className="spinner" /> : <ArrowUpFromLine size={13} />} <span className="btn-label">push</span>
          </button>
          <button className="btn small" onClick={() => void load()} disabled={loading} aria-label="aggiorna">
            {loading ? <Loader2 size={13} className="spinner" /> : <RefreshCw size={13} />}
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="changes-notice">{notice}</div>}

      <div className="changes-layout">
        <div className="changes-list">
          {zones.map((zone) => (
            <section key={zone.id} className="zone">
              <div className="zone-head" style={{ color: zone.color }}>
                {zone.label}
                <span className="count">{zone.groups.reduce((n, g) => n + g.files.length, 0)}</span>
              </div>
              {zone.groups.map((group) => {
                const groupKey = `${zone.id}:${group.id}`
                const open = !collapsed.has(groupKey)
                return (
                  <div key={group.id} className="group">
                    <button className="group-head" onClick={() => toggleGroup(groupKey)} aria-expanded={open}>
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span className="label">{GROUP_LABELS[group.label] ?? group.label}</span>
                      <span className="count">{group.files.length}</span>
                    </button>
                    {open && group.files.map((row) => {
                      const { ch, color } = statusLetter(row)
                      const dir = dirOf(row.path)
                      const active = selected === keyOf(row)
                      return (
                        <div
                          key={keyOf(row)}
                          role="button"
                          tabIndex={0}
                          aria-current={active || undefined}
                          className={`change-row${active ? ' active' : ''}`}
                          onClick={() => void openDiff(row)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                            e.preventDefault()
                            void openDiff(row)
                          }}
                        >
                          <span className="status" style={{ color }}>{ch}</span>
                          <span className="file-title">
                            <span className="name">{fileNameOf(row.path)}</span>
                            {/* cut from the start, the deepest folder stays visible: rtl moves the ellipsis, bdi keeps the text ltr */}
                            {dir && <span className="dir"><bdi>{dir}</bdi></span>}
                          </span>
                          {row.zone !== 'conflict' && (
                            <button
                              className={`icon-btn ${row.zone === 'staged' ? 'ok' : 'warn'}`}
                              onClick={(e) => { e.stopPropagation(); void stageToggle(row) }}
                              aria-label={row.zone === 'staged' ? 'unstage' : 'stage'}
                            >
                              {row.zone === 'staged' ? <Minus size={14} /> : <Plus size={14} />}
                            </button>
                          )}
                          {/* a conflict is solved by editing and staging the file, not by discarding it */}
                          {row.zone !== 'conflict' && (
                            <button
                              className="icon-btn danger"
                              onClick={(e) => { e.stopPropagation(); void discard(row) }}
                              aria-label={row.untracked ? 'elimina file nuovo' : 'scarta'}
                            >
                              <Undo2 size={14} />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </section>
          ))}
          {!loading && rows.length === 0 && <div className="empty-state">nessuna modifica</div>}
        </div>

        {inspector}
      </div>

      {stagedCount > 0 && (
        <div className="card">
          <label className="field">
            Messaggio di commit
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="#123 : descrizione" />
          </label>
          <button className="btn primary" onClick={() => void commit()} disabled={!message.trim()}>
            <Send size={15} /> commit · {stagedCount} file
          </button>
        </div>
      )}
    </>
  )
}
