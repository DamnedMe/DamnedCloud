import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Rocket, RefreshCw, Loader2, GitPullRequest, Link2, AlertTriangle, XCircle, Clock, ChevronRight, ChevronDown, Ban, Trash2, Info
} from 'lucide-react'
import { useRemoteStore, sendConfirmed } from '../lib/store'
import { RemoteError } from '../lib/connection'
import { isDeclined, useBridgeRefresh } from './bridgeHelpers'
import {
  CHAIN_STATUS, STAGES, actionable, chainFollows, chainNotice, chainSteps, commitCount, createNotice, createdLabel, firstLine, isChainActive, itemCount,
  nothingNote, stageRoles, stepsLeft, type Notice
} from '../lib/release'
import type {
  ReleaseChainItem, ReleaseChainView, ReleaseCreated, ReleasePr, ReleaseRepoPreview, ReleaseRole, ReleaseScope, ReleaseSide, ReleaseStage, ReleaseState
} from '../shared/remote/protocol'

const SCOPES: [ReleaseScope, string][] = [['be', 'BE'], ['fe', 'FE'], ['both', 'BE+FE']]

/**
 * The desktop Release panel on the phone: develop → qa, qa → prod or the chain develop → qa →
 * prod, one PR per repository (BE / FE of the open folder's Azure DevOps project). The bridge
 * reads everything again before creating and asks to confirm whatever reaches prod.
 */
export function ReleaseScreen() {
  const send = useRemoteStore((s) => s.send)
  const repoPath = useRemoteStore((s) => s.workspace?.repoPath ?? null)
  const canRun = useRemoteStore((s) => !!s.device?.scopes.includes('git'))
  const [state, setState] = useState<ReleaseState | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  // the desktop's last stage once the state is read; switching it here is not saved
  const [stage, setStage] = useState<ReleaseStage | null>(null)
  const [scope, setScope] = useState<ReleaseScope>('be')
  const [previews, setPreviews] = useState<ReleaseRepoPreview[]>([])
  const [loading, setLoading] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  // unticked work items, as `${side}:${id}`
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [openCommits, setOpenCommits] = useState<Set<ReleaseSide>>(() => new Set())
  const [autoComplete, setAutoComplete] = useState(false)
  const [created, setCreated] = useState<Partial<Record<ReleaseSide, ReleaseCreated>>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const loadState = useCallback(async () => {
    try {
      const next = await send<ReleaseState>('release.state')
      setState(next)
      setStateError(null)
      setStage((s) => s ?? next.stage)
    } catch (e) {
      setStateError(e instanceof RemoteError && e.code === 'unknown_command'
        ? 'Aggiorna DamnedIDE sul desktop: questa versione non porta il rilascio sul telefono'
        : (e as Error).message)
    }
  }, [send])

  useEffect(() => {
    setState(null)
    setStage(null)
    void loadState()
  }, [loadState, repoPath])

  // release choices saved on the desktop, chains moving: read the state again
  useBridgeRefresh(['release.changed'], [repoPath], () => void loadState())

  const ready = !!state && !state.unavailable
  const be = state?.be ?? ''
  const fe = state?.fe ?? ''
  const hasTargets = (scope !== 'fe' && !!be) || (scope !== 'be' && !!fe)
  const chainMode = stage === 'dev-qa-prod'
  const roles = stageRoles(stage ?? 'dev-qa')

  useEffect(() => {
    setPreviews([])
    setExcluded(new Set())
    setCreated({})
    setNotice(null)
    if (!ready || !stage || !hasTargets) return
    let cancelled = false
    setLoading(true)
    send<ReleaseRepoPreview[]>('release.preview', { stage, scope })
      .then((list) => { if (!cancelled) setPreviews(list) })
      .catch((e) => { if (!cancelled) setNotice({ text: (e as Error).message || 'Azure DevOps non raggiungibile', error: true }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [send, ready, stage, scope, be, fe, hasTargets, state?.organization, state?.project, reloadTick])

  // a chain step forward (qa → prod PR created, chain settled) changes what the previews offer
  const chains = state?.chains ?? []
  const left = stepsLeft(chains)
  const prevLeft = useRef(left)
  useEffect(() => {
    if (left < prevLeft.current) setReloadTick((t) => t + 1)
    prevLeft.current = left
  }, [left])

  const saveConfig = async (patch: Record<string, unknown>) => {
    setBusy(true)
    setNotice(null)
    try {
      setState(await send<ReleaseState>('release.setConfig', patch))
      setReloadTick((t) => t + 1)
    } catch (e) {
      setNotice({ text: `scelta di rilascio non salvata: ${(e as Error).message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const todo = actionable(previews, chainMode, created, chains)
  const markCreated = (list: ReleaseCreated[]) => setCreated((prev) => ({ ...prev, ...Object.fromEntries(list.map((r) => [r.side, r])) }))

  const run = async () => {
    if (!stage || todo.length === 0 || busy) return
    setBusy(true)
    setNotice(null)
    const args = { scope, autoComplete, excluded: [...excluded] }
    try {
      if (chainMode) {
        const res = await sendConfirmed<{ created: ReleaseCreated[]; chain: ReleaseChainView | null }>('release.chainStart', args)
        markCreated(res.created)
        setNotice(chainNotice(res))
        void loadState()
      } else {
        const res = await sendConfirmed<ReleaseCreated[]>('release.create', { ...args, stage })
        markCreated(res)
        setNotice(createNotice(res))
      }
    } catch (e) {
      if (!isDeclined(e)) setNotice({ text: (e as Error).message || 'Azure DevOps non raggiungibile', error: true })
    } finally {
      setBusy(false)
    }
  }

  const chainAction = async (cmd: 'release.chainCancel' | 'release.chainRemove', id: string, ask?: string) => {
    if (ask && !window.confirm(ask)) return
    try {
      await send(cmd, { id })
      await loadState()
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true })
    }
  }

  const toggle = <T,>(set: Set<T>, value: T): Set<T> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  if (stateError || !state || state.unavailable) {
    return (
      <div className="card release-empty">
        <Rocket size={28} strokeWidth={1.25} />
        {stateError || state?.unavailable || <Loader2 size={18} className="spinner" />}
        {(stateError || state?.unavailable) && (
          <button className="btn small" onClick={() => { setStateError(null); void loadState() }}>
            <RefreshCw size={13} /> riprova
          </button>
        )}
      </div>
    )
  }

  const repoOptions = (current: string, skip?: string) => {
    const list = state.repos.filter((r) => !skip || r.toLowerCase() !== skip.toLowerCase())
    if (current && !list.some((r) => r.toLowerCase() === current.toLowerCase())) list.unshift(current)
    return list.map((r) => (
      <option key={r} value={r}>{r}{r.toLowerCase() === state.folderRepo.toLowerCase() ? ' (cartella)' : ''}</option>
    ))
  }

  const branchPick = (p: ReleaseRepoPreview, role: ReleaseRole, value: string | null | undefined, locked: boolean) =>
    p.branches.length === 0 ? (
      <span className="branch-name">{value ?? role}</span>
    ) : (
      <select
        className={`branch-pick${value ? '' : ' missing'}`}
        value={value ?? ''}
        disabled={locked || busy || !canRun}
        aria-label={`branch ${role} di ${p.repo}`}
        // a native select is as wide as its longest option (a long feature branch fills the row):
        // sized on the chosen branch, in ch of the mono font, as in the desktop panel
        style={{ width: `${Math.min((value ?? `${role}?`).length, 26) + 8}ch` }}
        onChange={(e) => void saveConfig({ branch: { repo: p.repo, role, name: e.target.value } })}
      >
        {!value && <option value="">{role}?</option>}
        {p.branches.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    )

  const prLink = (pr: ReleasePr, label: string, tone: 'ok' | 'warn' | 'accent') => (
    <a className={`pr-badge ${tone}`} href={pr.url} target="_blank" rel="noreferrer">
      {label} ↗
    </a>
  )

  const renderCard = (p: ReleaseRepoPreview) => {
    const found = !!p.source && !!p.target && (!chainMode || !!p.prod)
    const made = created[p.side]
    const locked = !!p.existing || !!made?.ok
    const commitsOpen = openCommits.has(p.side)
    const missingRole = !p.source ? roles.from : !p.target ? roles.to : 'prod'
    const nothing = nothingNote(p, chainMode)
    const running = chainMode && (!!p.chainRunning || chainFollows(chains, p.repo))
    return (
      <div key={p.side} className="card release-card">
        <div className="release-card-head">
          <span className="side-tag">{p.side}</span>
          <strong className="release-repo">{p.repo}</strong>
          {p.existing && prLink(p.existing, `PR #${p.existing.id} già attiva`, 'warn')}
          {made?.ok && made.pr && prLink(made.pr, createdLabel(made), made.notArmed ? 'warn' : 'ok')}
        </div>
        <div className="branch-flow">
          {branchPick(p, roles.from, p.source, locked)}
          <span className="arrow">→</span>
          {branchPick(p, roles.to, p.target, locked)}
          {chainMode && (
            <>
              <span className="arrow">→</span>
              {branchPick(p, 'prod', p.prod, locked)}
            </>
          )}
        </div>
        {found && !p.error && <div className="muted mono">{commitCount(p.commits.length)} · {itemCount(p.workItems.length)}</div>}

        {p.error && <div className="note err"><XCircle size={13} />{p.error}</div>}
        {!p.error && !found && (
          <div className="note warn">
            <AlertTriangle size={13} />branch {missingRole} non trovato in {p.repo}: sceglilo dall’elenco (resta salvato per questa repository)
          </div>
        )}
        {running && (
          <div className="note accent"><Link2 size={13} />catena di rilascio già in corso per {p.repo}: l’avanzamento è in «catene in corso», qui sotto</div>
        )}
        {p.warning && <div className="note warn"><AlertTriangle size={13} />{p.warning}</div>}
        {made && !made.ok && (
          <div className="note err"><XCircle size={13} />creazione PR fallita: controlla branch policies e permessi del PAT (dettaglio nel log dell’IDE)</div>
        )}
        {nothing && <div className="muted">{nothing}</div>}

        {p.workItems.length > 0 && (
          <div className="wi-list">
            {p.workItems.map((w) => {
              const key = `${p.side}:${w.id}`
              return (
                <label key={w.id} className="wi-row">
                  <input type="checkbox" checked={!excluded.has(key)} disabled={locked || busy || !canRun}
                    onChange={() => setExcluded((s) => toggle(s, key))} />
                  <span className="wi-text">
                    <span className="wi-meta">
                      <span className="wi-id">#{w.id}</span>
                      {w.type && <span className="side-tag soft">{w.type}</span>}
                      {w.state && <span className="muted">{w.state}</span>}
                    </span>
                    <span className="wi-title">{w.title}</span>
                  </span>
                </label>
              )
            })}
          </div>
        )}

        {p.commits.length > 0 && (
          <div>
            <button className="link-btn" onClick={() => setOpenCommits((s) => toggle(s, p.side))} aria-expanded={commitsOpen}>
              {commitsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {commitCount(p.commits.length)}
            </button>
            {commitsOpen && (
              <div className="commit-list">
                {p.commits.map((c) => (
                  <div key={c.commitId} className="commit-row">
                    <span className="muted">{c.commitId.slice(0, 8)}</span> {firstLine(c.message)}
                    {c.author && <span className="muted"> — {c.author}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderChainItem = (item: ReleaseChainItem) => {
    const { dev, qa, prod } = item.branches
    const chip = CHAIN_STATUS[item.status]
    const steps = chainSteps(item)
    const qaWaiting = item.status === 'waiting-qa'
    const prodWaiting = item.status === 'waiting-prod'
    return (
      <div key={item.side} className="chain-item">
        <div className="release-card-head">
          <span className="side-tag">{item.side}</span>
          <strong className="release-repo">{item.repo}</strong>
          <span className={`chip ${chip.tone}`}>{chip.label}</span>
        </div>
        <div className="chain-step">
          <span className="muted">1. {dev} → {qa}</span>
          {item.qaPr && prLink(item.qaPr, `PR #${item.qaPr.id}`, 'accent')}
          {qaWaiting && <Clock size={12} />}
          <span className={steps.warn1 ? 'warn-text' : undefined}>{steps.step1}</span>
        </div>
        <div className="chain-step">
          <span className="muted">2. {qa} → {prod}</span>
          {item.prodPr && prLink(item.prodPr, `PR #${item.prodPr.id}`, 'accent')}
          {(qaWaiting || prodWaiting) && <Clock size={12} />}
          {item.status === 'creating-prod' && <Loader2 size={12} className="spinner" />}
          <span className={steps.warn2 ? 'warn-text' : undefined}>{steps.step2}</span>
        </div>
        {item.error && <div className="note err"><XCircle size={13} />{item.error}</div>}
        {item.lastError && (
          <div className="note warn"><AlertTriangle size={13} />ultimo controllo non riuscito: {item.lastError} · nuovo tentativo ogni 30 s</div>
        )}
      </div>
    )
  }

  const renderChain = (chain: ReleaseChainView) => {
    const active = isChainActive(chain)
    return (
      <div key={chain.id} className="card chain-card">
        <div className="chain-head">
          <span>avviata {new Date(chain.createdAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>· {chain.autoComplete ? 'auto-complete sulle PR nuove' : 'PR lasciate aperte'}</span>
          {canRun && (active ? (
            <button className="btn small push-right" onClick={() => void chainAction('release.chainCancel', chain.id,
              'Annullare la catena? Nessuna PR qa → prod verrà più creata o seguita; le PR già create restano in Azure DevOps.')}>
              <Ban size={12} /> annulla
            </button>
          ) : (
            <button className="btn small push-right" onClick={() => void chainAction('release.chainRemove', chain.id)}>
              <Trash2 size={12} /> rimuovi
            </button>
          ))}
        </div>
        {chain.items.map(renderChainItem)}
      </div>
    )
  }

  const runLabel = chainMode
    ? `avvia catena (${todo.length})`
    : todo.length === 1 ? 'crea 1 PR' : `crea ${todo.length} PR`

  return (
    <>
      <div className="screen-head">
        <div className="row" style={{ minWidth: 0 }}>
          <Rocket size={16} color="var(--accent)" />
          <strong>Rilascio</strong>
          <span className="muted mono release-project">{state.organization} / {state.project}</span>
        </div>
        <button className="icon-btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading || busy} aria-label="ricarica">
          {loading ? <Loader2 size={15} className="spinner" /> : <RefreshCw size={15} />}
        </button>
      </div>

      <div className="card">
        <div className="seg text full" role="group" aria-label="fase">
          {STAGES.map(([value, label]) => (
            <button key={value} className={stage === value ? 'on' : ''} aria-pressed={stage === value} disabled={busy}
              onClick={() => setStage(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="seg text full" role="group" aria-label="repository">
          {SCOPES.map(([value, label]) => (
            <button key={value} className={scope === value ? 'on' : ''} aria-pressed={scope === value} disabled={busy}
              onClick={() => setScope(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid-cols">
          <label className="field">
            BE
            <select value={be} disabled={busy || !canRun} onChange={(e) => void saveConfig({ beRepo: e.target.value })}>
              {!be && <option value="">—</option>}
              {repoOptions(be)}
            </select>
          </label>
          <label className="field">
            FE
            <select value={fe} disabled={busy || !canRun} onChange={(e) => void saveConfig({ feRepo: e.target.value })}>
              <option value="">—</option>
              {repoOptions(fe, be)}
            </select>
          </label>
        </div>
        {state.reposError && (
          <div className="note warn"><AlertTriangle size={13} />repository del project non lette ({state.reposError}): BE e FE restano quelle salvate</div>
        )}
      </div>

      {scope !== 'fe' && !be && <div className="note warn"><AlertTriangle size={13} />scegli la repository BE di {state.project}: resta salvata per i prossimi rilasci</div>}
      {scope !== 'be' && !fe && <div className="note warn"><AlertTriangle size={13} />scegli la repository FE di {state.project}: resta salvata per i prossimi rilasci</div>}
      {!canRun && (
        <div className="note accent"><Info size={13} />sola lettura: per creare PR abilita «Operazioni Git» per questo telefono nel desktop</div>
      )}

      <div className="release-repos">{previews.map(renderCard)}</div>
      {loading && (
        <div className="muted row"><Loader2 size={13} className="spinner" /> lettura da Azure DevOps…</div>
      )}

      {notice && (
        <div className={notice.error ? 'error-banner' : 'changes-notice'} onClick={() => setNotice(null)}>{notice.text}</div>
      )}

      {canRun && (
        <div className="release-actions">
          <label className="check-row">
            <input type="checkbox" checked={autoComplete} disabled={busy} onChange={(e) => setAutoComplete(e.target.checked)} />
            auto-complete quando le policy sono soddisfatte
          </label>
          <button className={`btn ${stage === 'dev-qa' ? 'primary' : 'caution'}`} onClick={() => void run()}
            disabled={todo.length === 0 || busy || loading}>
            {busy ? <Loader2 size={14} className="spinner" /> : chainMode ? <Link2 size={14} /> : <GitPullRequest size={14} />}
            {runLabel}
          </button>
        </div>
      )}

      {chains.length > 0 && (
        <section className="release-chains" aria-label="catene in corso">
          <div className="zone-head plain">
            <Link2 size={12} /> catene in corso
            <span className="hint">seguite da DamnedIDE ogni 30 s, anche dopo un riavvio</span>
          </div>
          {chains.map(renderChain)}
        </section>
      )}
    </>
  )
}
