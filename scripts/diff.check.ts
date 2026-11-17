// node --experimental-strip-types scripts/diff.check.ts
import assert from 'node:assert/strict'
import { firstChangeTarget, parseDiff, toSplitRows } from '../src/lib/diff.ts'

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

console.log('diff.check ok')
