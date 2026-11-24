// node --experimental-strip-types scripts/diff.check.ts
import assert from 'node:assert/strict'
import { firstChangeTarget, parseDiff, toSplitRows, unifiedDiff } from '../src/lib/diff.ts'

const diff = [
  'diff --git a/src/A.cs b/src/A.cs',
  'index 1111111..2222222 100644',
  '--- a/src/A.cs',
  '+++ b/src/A.cs',
  '@@ -10,4 +10,5 @@ class A',
  ' keep',
  '-old one',
  '-old two',
  '+new one',
  '+new two',
  '+new three',
  ' tail',
  '@@ -40,2 +41,1 @@',
  '---- a deleted line that starts with dashes',
  ' end',
  '\\ No newline at end of file',
  ''
].join('\r\n')

const lines = parseDiff(diff)
// headers before the first hunk are dropped, the trailing empty line too
assert.equal(lines[0].kind, 'hunk')
assert.deepEqual(lines.map((l) => l.kind), ['hunk', 'ctx', 'del', 'del', 'add', 'add', 'add', 'ctx', 'hunk', 'del', 'ctx', 'meta'])

const [, keep, del1, del2, add1, , add3, tail, , dashes, end] = lines
assert.deepEqual([keep.old, keep.new, keep.target], [10, 10, 10])
// a deleted line opens the editor where it was: the next line of the new file
assert.deepEqual([del1.old, del1.new, del1.target], [11, null, 11])
assert.deepEqual([del2.old, del2.target], [12, 11])
assert.deepEqual([add1.new, add1.target], [11, 11])
assert.deepEqual([add3.new, add3.target], [13, 13])
assert.deepEqual([tail.old, tail.new], [13, 14])
assert.equal(dashes.text, '--- a deleted line that starts with dashes')
assert.deepEqual([dashes.old, dashes.target], [40, 41])
assert.deepEqual([end.old, end.new], [41, 41])

// side by side: 2 deletions against 3 additions, the left side padded
const split = toSplitRows(lines)
assert.deepEqual(split.slice(2, 5).map((r) => [r.left?.text ?? null, r.right?.text ?? null]), [
  ['old one', 'new one'],
  ['old two', 'new two'],
  [null, 'new three']
])
assert.equal(split.length, lines.length - 2)

assert.equal(firstChangeTarget(lines), 11)

// deleted file: the editor target never goes below line 1
assert.equal(parseDiff('@@ -1,2 +0,0 @@\n-a\n-b\n')[1].target, 1)
// new file preview built by ChangesScreen
assert.deepEqual(parseDiff('@@ -0,0 +1,2 @@ nuovo file\n+a\n+b').map((l) => l.new), [null, 1, 2])
// no hunk: binary file or error text, shown raw by the inspector
assert.deepEqual(parseDiff('// file binario'), [])
assert.equal(firstChangeTarget([]), 1)

// ── unifiedDiff: base side vs worktree, for the "diff con develop" view ──
assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '', 'same text: nothing')
assert.equal(unifiedDiff('a\r\nb\r\n', 'a\nb\n'), '', 'line endings alone are not a change')
assert.equal(unifiedDiff('', 'x\ny\n'), '@@ -0,0 +1,2 @@\n+x\n+y', 'new file')
assert.equal(unifiedDiff('x\ny\n', ''), '@@ -1,2 +0,0 @@\n-x\n-y', 'deleted file')
assert.equal(unifiedDiff('a\0', 'b\0'), '// file binario')
const base = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)
const edited = [...base]
edited[1] = 'changed 2'
edited.splice(15, 1)
edited.push('added 21')
assert.equal(unifiedDiff(base.join('\n'), edited.join('\n')), [
  '@@ -1,5 +1,5 @@', ' line 1', '-line 2', '+changed 2', ' line 3', ' line 4', ' line 5',
  '@@ -13,8 +13,8 @@', ' line 13', ' line 14', ' line 15', '-line 16', ' line 17', ' line 18', ' line 19', ' line 20', '+added 21'
].join('\n'), 'two hunks, git numbering; changes 6 apart share one')
const parsed = parseDiff(unifiedDiff(base.join('\n'), edited.join('\n')))
assert.deepEqual(parsed.find((l) => l.kind === 'add')?.new, 2)

// random edits: applying the diff to the original gives back the modified text, with the fewest changes
let seed = 7
const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
function apply(original: string[], diff: string): string[] {
  const out: string[] = []
  let at = 0
  for (const line of diff.split('\n')) {
    const h = /^@@ -(\d+),(\d+) /.exec(line)
    if (h) { const start = Number(h[2]) ? Number(h[1]) - 1 : Number(h[1]); while (at < start) out.push(original[at++]); continue }
    if (line[0] === '+') out.push(line.slice(1))
    else if (line[0] === '-') { assert.equal(original[at], line.slice(1)); at++ }
    else if (line[0] === ' ') { assert.equal(original[at], line.slice(1)); out.push(original[at++]) }
  }
  while (at < original.length) out.push(original[at++])
  return out
}
for (let round = 0; round < 300; round++) {
  const a = Array.from({ length: rnd(40) }, () => `l${rnd(8)}`)
  const b = [...a]
  for (let e = rnd(6); e > 0; e--) {
    const p = rnd(b.length + 1)
    if (rnd(2) && b.length) b.splice(p, 1)
    else b.splice(p, 0, `n${rnd(8)}`)
  }
  const d = unifiedDiff(a.join('\n'), b.join('\n'), rnd(4))
  assert.deepEqual(apply(a, d), b, `round ${round}`)
}

console.log('diff.check ok')
