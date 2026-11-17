// Self-check for the Rilascio tab helpers (src/lib/release.ts).
// Run: node --experimental-strip-types scripts/release.check.ts
import assert from 'node:assert/strict'
import { actionable, chainNotice, chainSteps, createNotice, createdLabel, nothingNote, stepsLeft } from '../src/lib/release.ts'
import type { ReleaseChainItem, ReleaseChainView, ReleaseRepoPreview } from '../src/shared/remote/protocol.ts'

const branches = { dev: 'develop', qa: 'qa', prod: 'main' }
const preview = (p: Partial<ReleaseRepoPreview>): ReleaseRepoPreview => ({
  side: 'BE', repo: 'Themis-API', branches: ['develop', 'qa', 'main'], source: 'develop', target: 'qa',
  commits: [], workItems: [], existing: null, ...p
})
const commit = { commitId: 'a', message: '#1', author: 'x' }
const item = (i: Partial<ReleaseChainItem>): ReleaseChainItem => ({ side: 'BE', repo: 'Themis-API', branches, status: 'waiting-qa', updatedAt: 0, ...i })
const chain = (items: ReleaseChainItem[]): ReleaseChainView => ({ id: 'k', organization: 'o', project: 'p', autoComplete: false, createdAt: 0, items })

// ── what create / chainStart act on ──
{
  const be = preview({ commits: [commit] })
  const fe = preview({ side: 'FE', repo: 'Themis-Frontend' })
  assert.deepEqual(actionable([be, fe], false, {}, []).map(p => p.side), ['BE'], 'nothing to promote is left out')
  assert.deepEqual(actionable([be], false, { BE: { side: 'BE', repo: 'Themis-API', ok: true } }, []), [], 'a PR just created is done')
  assert.equal(actionable([be], false, { BE: { side: 'BE', repo: 'Themis-API', ok: false } }, []).length, 1, 'a failed one can be tried again')
  assert.deepEqual(actionable([preview({ commits: [commit], existing: { id: 7, url: '' } })], false, {}, []), [], 'an active PR is not doubled')
  assert.deepEqual(actionable([preview({ target: null, commits: [commit] })], false, {}, []), [], 'a missing branch blocks')
  // chain: an active PR is followed, prod commits start at step 2, a running chain holds the repository
  const followed = preview({ prod: 'main', existing: { id: 7, url: '' } })
  const step2 = preview({ side: 'FE', repo: 'Themis-Frontend', prod: 'master', prodCommits: 2 })
  assert.deepEqual(actionable([followed, step2], true, {}, []).map(p => p.side), ['BE', 'FE'])
  assert.deepEqual(actionable([followed], true, {}, [chain([item({ repo: 'THEMIS-api' })])]), [])
  assert.equal(actionable([followed], true, {}, [chain([item({ status: 'done' })])]).length, 1, 'a finished chain no longer holds it')
  assert.deepEqual(actionable([preview({ commits: [commit] })], true, {}, []), [], 'the chain needs the prod branch')
}

// ── notes ──
assert.equal(nothingNote(preview({}), false), 'nulla da promuovere: qa contiene già tutti i commit di develop')
assert.equal(nothingNote(preview({ commits: [commit] }), false), null)
assert.equal(nothingNote(preview({ prod: 'main', prodCommits: 3 }), true), 'develop → qa: nulla da promuovere, la catena parte da qa → main (3 commit)')
assert.equal(nothingNote(preview({ prod: 'main', prodExisting: { id: 9, url: '' } }), true), 'develop → qa: nulla da promuovere; PR #9 qa → main già aperta')
assert.equal(nothingNote(preview({ prod: 'main' }), true), 'nulla da promuovere: qa e main contengono già tutti i commit')
assert.equal(createdLabel({ side: 'BE', repo: 'r', ok: true, pr: { id: 5, url: '' }, mode: 'open', notArmed: true }), 'PR #5 creata, auto-complete non armato')
assert.deepEqual(createNotice([{ side: 'BE', repo: 'r', ok: true, pr: { id: 5, url: '' } }, { side: 'FE', repo: 'f', ok: false }]),
  { text: 'PR create: BE #5 · fallite: FE', error: true })
assert.deepEqual(createNotice([{ side: 'BE', repo: 'r', ok: true, pr: { id: 5, url: '' } }]), { text: 'PR di rilascio create: BE #5' })
assert.deepEqual(chainNotice({ created: [{ side: 'BE', repo: 'r', ok: false }], chain: null }), { text: 'catena non avviata: PR develop → qa fallite (BE)', error: true })
assert.equal(chainNotice({ created: [], chain: chain([item({ side: 'FE', repo: 'Themis-Frontend' })]) }).text, 'catena di rilascio avviata: FE Themis-Frontend')

// ── chain steps, as the desktop card ──
assert.deepEqual(chainSteps(item({ qaPr: { id: 1, url: '' }, qaNoAutoComplete: true })), {
  step1: 'in attesa del completamento · auto-complete non armato: impostalo da Azure DevOps',
  step2: 'partirà quando la PR develop → qa è completata', warn1: true, warn2: false
})
assert.deepEqual(chainSteps(item({ status: 'creating-prod' })), { step1: 'nulla da promuovere', step2: 'creazione in corso…', warn1: false, warn2: false })
assert.equal(chainSteps(item({ status: 'waiting-prod', qaPr: { id: 1, url: '' }, prodPr: { id: 2, url: '' }, prodReused: true })).step2,
  'già attiva: seguita dalla catena, in attesa del completamento')
assert.deepEqual(chainSteps(item({ status: 'done', qaPr: { id: 1, url: '' }, prodPr: { id: 2, url: '' }, prodDone: true })).step1 + '|' +
  chainSteps(item({ status: 'done', qaPr: { id: 1, url: '' }, prodPr: { id: 2, url: '' }, prodDone: true })).step2, 'completata|completata')
assert.equal(chainSteps(item({ status: 'failed', qaPr: { id: 1, url: '' }, prodPr: { id: 2, url: '' } })).step2, 'abbandonata')
assert.equal(chainSteps(item({ status: 'cancelled', qaPr: { id: 1, url: '' } })).step2, 'non creata: catena annullata')
assert.equal(chainSteps(item({ status: 'done', note: 'nulla da promuovere in prod' })).step2, 'nulla da promuovere in prod')

// ── a step forward lowers the count, starting a chain does not ──
assert.equal(stepsLeft([chain([item({}), item({ status: 'waiting-prod' }), item({ status: 'done' })])]), 3)

console.log('release.check ok')
