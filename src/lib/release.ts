// Pure helpers of the Rilascio tab (screens/ReleaseScreen.tsx): what the desktop Release panel
// (DamnedIDE PromotionPanel) decides and writes, in Italian. Checked by scripts/release.check.ts.
import type {
  ReleaseChainItem, ReleaseChainStatus, ReleaseChainView, ReleaseCreated, ReleaseRepoPreview, ReleaseRole, ReleaseSide, ReleaseStage
} from '../shared/remote/protocol'

export const STAGES: [ReleaseStage, string][] = [
  ['dev-qa', 'develop → qa'],
  ['qa-prod', 'qa → prod'],
  ['dev-qa-prod', 'dev → qa → prod']
]

export const commitCount = (n: number): string => `${n} commit`
export const itemCount = (n: number): string => `${n} work item`

/** First line of a commit message, trimmed. */
export const firstLine = (message: string): string => (message.split(/\r?\n/)[0] || '').trim()

/** The two roles a stage promotes (the chain previews its first step, develop → qa). */
export function stageRoles(stage: ReleaseStage): { from: ReleaseRole; to: ReleaseRole } {
  return stage === 'qa-prod' ? { from: 'qa', to: 'prod' } : { from: 'dev', to: 'qa' }
}

export type Tone = 'accent' | 'ok' | 'err' | 'muted'

export const CHAIN_STATUS: Record<ReleaseChainStatus, { label: string; tone: Tone }> = {
  'waiting-qa': { label: 'in attesa di qa', tone: 'accent' },
  'creating-prod': { label: 'creazione PR prod', tone: 'accent' },
  'waiting-prod': { label: 'in attesa di prod', tone: 'accent' },
  done: { label: 'completata', tone: 'ok' },
  failed: { label: 'interrotta', tone: 'err' },
  cancelled: { label: 'annullata', tone: 'muted' }
}

const isActiveStatus = (s: ReleaseChainStatus): boolean => s === 'waiting-qa' || s === 'creating-prod' || s === 'waiting-prod'

export const isChainActive = (chain: ReleaseChainView): boolean => chain.items.some((i) => isActiveStatus(i.status))

/** A running chain of the project follows `repo` (names compare case-insensitively). */
export function chainFollows(chains: ReleaseChainView[], repo: string): boolean {
  return chains.some((c) => c.items.some((i) => isActiveStatus(i.status) && i.repo.toLowerCase() === repo.toLowerCase()))
}

/**
 * Steps the chains still have to take (pre-prod 2, waiting-prod 1, finished 0): every step forward
 * lowers it and starting a chain does not, so a drop means the previews changed (read them again).
 */
export function stepsLeft(chains: ReleaseChainView[]): number {
  return chains.reduce((n, c) => n + c.items.reduce((m, i) =>
    m + (i.status === 'waiting-qa' || i.status === 'creating-prod' ? 2 : i.status === 'waiting-prod' ? 1 : 0), 0), 0)
}

/**
 * The previews the bridge would act on: release.create (one PR each: new commits, no active
 * promotion PR) or release.chainStart (also an active develop → qa PR, followed, or nothing for
 * qa but commits for prod). A PR just created here is done; a failed one can be tried again.
 */
export function actionable(
  previews: ReleaseRepoPreview[],
  chain: boolean,
  created: Partial<Record<ReleaseSide, ReleaseCreated>>,
  chains: ReleaseChainView[]
): ReleaseRepoPreview[] {
  return previews.filter((p) => {
    if (!p.source || !p.target || p.error || created[p.side]?.ok) return false
    if (!chain) return p.commits.length > 0 && !p.existing
    return !!p.prod && !p.chainRunning && !chainFollows(chains, p.repo) && (p.commits.length > 0 || !!p.existing || (p.prodCommits ?? 0) > 0)
  })
}

/** The "nothing to promote" line of a preview with its branches found, null when it has commits or an active PR. */
export function nothingNote(p: ReleaseRepoPreview, chain: boolean): string | null {
  if (!p.source || !p.target || p.error || p.commits.length > 0 || p.existing) return null
  if (!chain) return `nulla da promuovere: ${p.target} contiene già tutti i commit di ${p.source}`
  if (p.prodExisting) return `${p.source} → ${p.target}: nulla da promuovere; PR #${p.prodExisting.id} ${p.target} → ${p.prod} già aperta`
  if ((p.prodCommits ?? 0) > 0) {
    return `${p.source} → ${p.target}: nulla da promuovere, la catena parte da ${p.target} → ${p.prod} (${commitCount(p.prodCommits ?? 0)})`
  }
  return `nulla da promuovere: ${p.target} e ${p.prod} contengono già tutti i commit`
}

/** Label of the PR badge of a repository just released from here. */
export function createdLabel(c: ReleaseCreated): string {
  const id = c.pr?.id ?? 0
  if (c.mode === 'autocomplete') return `PR #${id} creata (auto-complete)`
  return c.notArmed ? `PR #${id} creata, auto-complete non armato` : `PR #${id} creata`
}

export interface Notice {
  text: string
  error?: boolean
}

/** Outcome of release.create, as the desktop toast. */
export function createNotice(results: ReleaseCreated[]): Notice {
  const done = results.filter((r) => r.ok).map((r) => `${r.side} #${r.pr?.id}`)
  const failed = results.filter((r) => !r.ok).map((r) => r.side)
  if (failed.length === 0) return { text: `PR di rilascio create: ${done.join(', ')}` }
  return { text: `PR create: ${done.length > 0 ? done.join(', ') : 'nessuna'} · fallite: ${failed.join(', ')}`, error: true }
}

/** Outcome of release.chainStart. */
export function chainNotice(res: { created: ReleaseCreated[]; chain: ReleaseChainView | null }): Notice {
  const failed = res.created.filter((r) => !r.ok).map((r) => r.side)
  if (!res.chain) return { text: `catena non avviata: PR develop → qa fallite (${failed.join(', ')})`, error: true }
  const names = res.chain.items.map((i) => `${i.side} ${i.repo}`).join(', ')
  if (failed.length === 0) return { text: `catena di rilascio avviata: ${names}` }
  return { text: `catena avviata per ${names} · PR develop → qa fallite: ${failed.join(', ')}`, error: true }
}

const NOT_ARMED = 'auto-complete non armato: impostalo da Azure DevOps'

/** What each step of a chain item is doing, as the desktop chain card writes it. */
export function chainSteps(item: ReleaseChainItem): { step1: string; step2: string; warn1: boolean; warn2: boolean } {
  const { dev, qa } = item.branches
  const qaWaiting = item.status === 'waiting-qa'
  const prodWaiting = item.status === 'waiting-prod'
  const warn1 = qaWaiting && !!item.qaNoAutoComplete
  const warn2 = prodWaiting && !item.prodReused && !!item.prodNoAutoComplete
  const step1 = !item.qaPr
    ? 'nulla da promuovere'
    : qaWaiting ? `in attesa del completamento${warn1 ? ` · ${NOT_ARMED}` : ''}`
      // a qa → prod PR only exists once develop → qa is completed
      : item.status === 'creating-prod' || prodWaiting || item.status === 'done' || item.prodPr ? 'completata' : ''
  const step2 = item.prodPr
    ? prodWaiting
      ? item.prodReused ? 'già attiva: seguita dalla catena, in attesa del completamento' : `in attesa del completamento${warn2 ? ` · ${NOT_ARMED}` : ''}`
      : item.prodDone ? 'completata'
        // no longer followed: failed = the qa → prod PR was abandoned; cancelled = it stays as it is
        : item.status === 'failed' ? 'abbandonata' : item.prodReused ? 'già attiva' : 'creata'
    : qaWaiting ? `partirà quando la PR ${dev} → ${qa} è completata`
      : item.status === 'creating-prod' ? 'creazione in corso…'
        : item.status === 'cancelled' ? 'non creata: catena annullata'
          : item.status === 'failed' ? 'non creata' : item.note ?? ''
  return { step1, step2, warn1, warn2 }
}
