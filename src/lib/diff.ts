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
