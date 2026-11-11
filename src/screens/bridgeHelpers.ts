import { useEffect, useRef } from 'react'
import { connection, ConfirmationDeclined } from '../lib/store'
import type { RemoteTopic } from '../shared/remote/protocol'

// ponytail: case-insensitive, the desktop is usually Windows; on a case-sensitive disk a false
// match only costs an extra reload
function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && normPath(a) === normPath(b)
}

/** true when one path is the other or contains it */
function overlaps(a: string, b: string): boolean {
  const x = normPath(a)
  const y = normPath(b)
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
}

/**
 * The user said no to a bridge confirmation: nothing failed, nothing to show. A challenge that
 * expired after the user accepted is not a refusal: sendConfirmed asks again, then throws an error to show.
 */
export function isDeclined(err: unknown): boolean {
  return err instanceof ConfirmationDeclined
}

/**
 * Calls `reload` when the bridge pushes one of `topics` about a path overlapping one of `paths`
 * (git.changed carries { repoPath }, fs.changed { root }). Debounced: one save or commit on the
 * desktop fires several events in a row. A bridge that never sends them simply never reloads.
 */
export function useBridgeRefresh(topics: RemoteTopic[], paths: (string | null | undefined)[], reload: () => void): void {
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const topicKey = topics.join('|')
  const pathKey = paths.filter(Boolean).join('|')

  useEffect(() => {
    if (!pathKey) return
    const watched = pathKey.split('|')
    let timer: ReturnType<typeof setTimeout> | undefined
    const onEvent = (data: unknown) => {
      const d = (data ?? {}) as { repoPath?: string | null; root?: string | null }
      const target = d.repoPath ?? d.root
      // an event without a path may concern us: a reload is cheap
      if (target && !watched.some((p) => overlaps(target, p))) return
      clearTimeout(timer)
      timer = setTimeout(() => reloadRef.current(), 300)
    }
    const offs = topicKey.split('|').map((topic) => connection.on(topic as RemoteTopic, onEvent))
    return () => {
      clearTimeout(timer)
      for (const off of offs) off()
    }
  }, [topicKey, pathKey])
}
