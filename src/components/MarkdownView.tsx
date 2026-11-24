import { useMemo, type CSSProperties, type ReactNode } from 'react'

// Port of DamnedIDE's MarkdownView (src/components/editor/MarkdownView.tsx): same parser, same
// subset (headings, bold/italic/strike/code/links, fenced code, lists, blockquotes, tables, rules).
// React elements only, no dangerouslySetInnerHTML: untrusted markdown is escaped by React.

interface Block {
  type: 'heading' | 'code' | 'list' | 'quote' | 'table' | 'hr' | 'paragraph'
  level?: number
  items?: string[][] // list items, each item = its lines
  ordered?: boolean
  code?: string
  lang?: string
  lines?: string[]
}

const isFence = (t: string) => /^```/.test(t) || /^~~~/.test(t)
const isRow = (t: string) => t.startsWith('|') && /^\|.*\|$/.test(t)

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') { i++; continue }

    const fence = trimmed.match(/^(```|~~~)(\w*)/)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !isFence(lines[i].trim())) { code.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', code: code.join('\n'), lang: fence[2] || '' })
      continue
    }

    const h = trimmed.match(/^(#{1,6})\s+(.*)/)
    if (h) { blocks.push({ type: 'heading', level: h[1].length, lines: [h[2] || ''] }); i++; continue }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: 'hr' }); i++; continue }

    if (trimmed.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', lines: quote })
      continue
    }

    const isListItem = /^[-*+]\s+/.test(trimmed)
    const isOrdItem = /^\d+\.\s+/.test(trimmed)
    if (isListItem || isOrdItem) {
      const items: string[][] = [[trimmed.replace(isListItem ? /^[-*+]\s+/ : /^\d+\.\s+/, '')]]
      i++
      while (i < lines.length) {
        const t = lines[i].trim()
        // a bullet after a numbered item (or the other way round) starts a new list
        if (/^[-*+]\s+/.test(t)) { if (isOrdItem) break; items.push([t.replace(/^[-*+]\s+/, '')]); i++; continue }
        if (/^\d+\.\s+/.test(t)) { if (isListItem) break; items.push([t.replace(/^\d+\.\s+/, '')]); i++; continue }
        if (t === '' || /^#{1,6}\s/.test(t) || isFence(t) || t.startsWith('>') || /^(-{3,})$/.test(t)) break
        items[items.length - 1].push(t)
        i++
      }
      blocks.push({ type: 'list', items, ordered: isOrdItem })
      continue
    }

    if (isRow(trimmed)) {
      const parseRow = (s: string) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const rows: string[][] = [parseRow(trimmed)]
      i++
      if (i < lines.length && /^\|[\s:|-]+\|$/.test(lines[i].trim())) i++
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { rows.push(parseRow(lines[i].trim())); i++ }
      blocks.push({ type: 'table', lines: rows.map((r) => r.join('|')) })
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const tt = lines[i].trim()
      if (tt === '' || /^#{1,6}\s/.test(tt) || isFence(tt) || tt.startsWith('>') || /^[-*+]\s+/.test(tt) || /^\d+\.\s+/.test(tt) || /^(-{3,})$/.test(tt) || isRow(tt)) break
      para.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', lines: para })
  }
  return blocks
}

const INLINE_RE = /(\*\*(.+?)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))|(~~(.+?)~~)/

/** Only links that leave the app: a relative or '#' href would navigate the app's own webview. */
const externalHref = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null)

function renderInline(text: string, keyBase: string): ReactNode[] {
  // inline code spans first: nothing inside them is markdown
  const out: ReactNode[] = []
  text.split(/(`[^`]+`)/g).forEach((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) out.push(<code key={`${keyBase}-c${i}`}>{part.slice(1, -1)}</code>)
    else if (part) out.push(...renderInlineSimple(part, `${keyBase}-${i}`))
  })
  return out
}

function renderInlineSimple(text: string, keyBase: string): ReactNode[] {
  const m = text.match(INLINE_RE)
  if (!m) return [text]
  const idx = m.index ?? 0
  const before = text.slice(0, idx)
  const rest = text.slice(idx + m[0].length)
  let node: ReactNode
  if (m[0].startsWith('**')) node = <strong key={`${keyBase}-b`}>{renderInlineSimple(m[2] ?? '', keyBase)}</strong>
  else if (m[0].startsWith('*')) node = <em key={`${keyBase}-e`}>{renderInlineSimple(m[4] ?? '', keyBase)}</em>
  else if (m[0].startsWith('[')) {
    const href = externalHref(m[7] ?? '')
    const label = renderInlineSimple(m[6] ?? '', keyBase)
    node = href
      ? <a key={`${keyBase}-a`} href={href} target="_blank" rel="noreferrer">{label}</a>
      : <span key={`${keyBase}-a`} className="md-link" title={m[7]}>{label}</span>
  } else node = <del key={`${keyBase}-s`}>{renderInlineSimple(m[9] ?? '', keyBase)}</del>
  return [before, node, ...renderInlineSimple(rest, keyBase)]
}

export function MarkdownView({ content, className = '', style }: { content: string; className?: string; style?: CSSProperties }) {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className={`md-view ${className}`} style={style}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const Tag = `h${b.level || 2}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return <Tag key={i}>{renderInline(b.lines?.[0] || '', `h${i}`)}</Tag>
          }
          case 'code':
            return <pre key={i}><code className={b.lang ? `lang-${b.lang}` : ''}>{b.code}</code></pre>
          case 'hr':
            return <hr key={i} />
          case 'quote':
            return (
              <blockquote key={i}>
                {b.lines?.map((l, j) => <p key={j}>{renderInline(l, `q${i}-${j}`)}</p>)}
              </blockquote>
            )
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i}>
                {b.items?.map((item, j) => (
                  <li key={j}>{item.map((l, k) => <span key={k}>{renderInline(l, `li${i}-${j}-${k}`)} </span>)}</li>
                ))}
              </Tag>
            )
          }
          case 'table': {
            const rows = (b.lines || []).map((r) => r.split('|'))
            const header = rows[0] || []
            return (
              // wide tables scroll sideways inside their box, never the whole screen
              <div key={i} className="md-table">
                <table>
                  <thead><tr>{header.map((c, j) => <th key={j}>{renderInline(c, `th${i}-${j}`)}</th>)}</tr></thead>
                  <tbody>
                    {rows.slice(1).map((r, j) => (
                      <tr key={j}>{r.map((c, k) => <td key={k}>{renderInline(c, `td${i}-${j}-${k}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
          default:
            return <p key={i}>{b.lines?.map((l, j) => <span key={j}>{renderInline(l, `p${i}-${j}`)} </span>)}</p>
        }
      })}
      {blocks.length === 0 && <p className="md-empty">(documento vuoto)</p>}
    </div>
  )
}

export const isMarkdown = (path: string | null | undefined) => !!path && /\.(md|markdown)$/i.test(path)
