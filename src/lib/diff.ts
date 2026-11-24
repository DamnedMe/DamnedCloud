// Unified diff → rows for the inspector (unified and side by side). Pure, no React:
// shared by DiffInspector and scripts/diff.check.ts.

export type DiffKind = 'hunk' | 'ctx' | 'add' | 'del' | 'meta'

export interface DiffLine {
  kind: DiffKind
  /** content without the +/-/space prefix; a hunk or meta line as git printed it */
  text: string
  /** line number in the old file (ctx, del) */
  old: number | null
  /** line number in the new file (ctx, add) */
  new: number | null
  /** line of the current file the editor opens on: a deleted line goes where it was */
  target: number
}

/** One row of the side-by-side view; a hunk, context or meta line sits on both sides. */
export interface SplitRow {
  left: DiffLine | null
  right: DiffLine | null
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Lines of the hunks; [] when the text has none (binary file, error message). */
export function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = []
  let oldN = 0
  let newN = 0
  let inHunk = false
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      oldN = Number(hunk[1])
      newN = Number(hunk[2])
      inHunk = true
      out.push({ kind: 'hunk', text: raw, old: null, new: null, target: Math.max(1, newN) })
      continue
    }
    // diff --git / index / --- / +++ before the first hunk: a "---" inside one is a deleted line
    if (!inHunk || raw === '') continue
    const at = Math.max(1, newN)
    switch (raw[0]) {
      case '+':
        out.push({ kind: 'add', text: raw.slice(1), old: null, new: newN, target: at })
        newN++
        break
      case '-':
        out.push({ kind: 'del', text: raw.slice(1), old: oldN, new: null, target: at })
        oldN++
        break
      case ' ':
        out.push({ kind: 'ctx', text: raw.slice(1), old: oldN, new: newN, target: at })
        oldN++
        newN++
        break
      default:
        // "\ No newline at end of file", "… altre N righe" of a new file preview
        out.push({ kind: 'meta', text: raw, old: null, new: null, target: at })
    }
  }
  return out
}

/** Deleted and added lines of one change side by side, the shorter side padded. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    dels = []
    adds = []
  }
  for (const line of lines) {
    if (line.kind === 'del') {
      // git prints a change as deletions then additions: a deletion after them starts the next one
      if (adds.length) flush()
      dels.push(line)
    } else if (line.kind === 'add') {
      adds.push(line)
    } else {
      flush()
      rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}

/** Where the editor opens with no line picked: the first change. */
export function firstChangeTarget(lines: DiffLine[]): number {
  return lines.find((l) => l.kind === 'add' || l.kind === 'del')?.target ?? lines[0]?.target ?? 1
}

// ─── Two texts → unified diff (the "diff con develop" view: base side vs worktree) ────────────

type Op = '=' | '-' | '+'

/** Edit distance past which the middle of the file is shown as replaced whole (memory ~ D²). */
const MAX_EDIT = 2000
/** Diff lines past which the text is cut (the phone renders every row). */
const MAX_DIFF_LINES = 5000

function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Myers' shortest edit script of a → b; null past MAX_EDIT. */
function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  // v as it was at the start of each round, only the diagonals the round reads (-d-1 … d+1)
  const trace: Int32Array[] = []
  for (let d = 0; d <= Math.min(max, MAX_EDIT); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[off + k] = x
      if (x >= n && y >= m) return backtrack(trace, n, m)
    }
  }
  return null
}

function backtrack(trace: Int32Array[], n: number, m: number): Op[] {
  const ops: Op[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const at = (k: number) => trace[d][k + d + 1]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { ops.push('='); x--; y-- }
    ops.push(x === prevX ? '+' : '-')
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) { ops.push('='); x--; y-- }
  return ops.reverse()
}

/**
 * Unified diff (hunks only, `context` lines around each change) of `original` → `modified`, as git
 * prints it: what parseDiff reads. '' when they are the same; a binary file is not compared.
 */
export function unifiedDiff(original: string, modified: string, context = 3): string {
  if (original.includes('\0') || modified.includes('\0')) return original === modified ? '' : '// file binario'
  const a = splitLines(original)
  const b = splitLines(modified)
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let post = 0
  while (post < a.length - pre && post < b.length - pre && a[a.length - 1 - post] === b[b.length - 1 - post]) post++
  const midA = a.slice(pre, a.length - post)
  const midB = b.slice(pre, b.length - post)
  const mid = myers(midA, midB) ?? [...midA.map((): Op => '-'), ...midB.map((): Op => '+')]
  const ops: Op[] = [...Array<Op>(pre).fill('='), ...mid, ...Array<Op>(post).fill('=')]
  if (!ops.some((op) => op !== '=')) return ''

  // line of a / b each op starts at (0-based)
  const ai: number[] = []
  const bi: number[] = []
  let x = 0
  let y = 0
  for (const op of ops) {
    ai.push(x)
    bi.push(y)
    if (op !== '+') x++
    if (op !== '-') y++
  }

  const out: string[] = []
  let i = 0
  while (i < ops.length) {
    if (ops[i] === '=') { i++; continue }
    const start = Math.max(0, i - context)
    // a hunk runs on while the next change is within 2 × context equal lines
    let end = i
    let j = i
    while (j < ops.length) {
      if (ops[j] !== '=') { end = j; j++; continue }
      let run = j
      while (run < ops.length && ops[run] === '=') run++
      if (run >= ops.length || run - j > 2 * context) break
      j = run
    }
    const stop = Math.min(ops.length, end + 1 + context)
    const slice = ops.slice(start, stop)
    const oldLen = slice.filter((op) => op !== '+').length
    const newLen = slice.filter((op) => op !== '-').length
    // git numbers an empty side from the line before it
    const oldStart = oldLen ? ai[start] + 1 : ai[start]
    const newStart = newLen ? bi[start] + 1 : bi[start]
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`)
    for (let k = start; k < stop; k++) {
      const op = ops[k]
      out.push(op === '+' ? `+${b[bi[k]]}` : op === '-' ? `-${a[ai[k]]}` : ` ${a[ai[k]]}`)
    }
    i = stop
  }
  if (out.length > MAX_DIFF_LINES) {
    const rest = out.length - MAX_DIFF_LINES
    out.length = MAX_DIFF_LINES
    out.push(`… altre ${rest} righe`)
  }
  return out.join('\n')
}
