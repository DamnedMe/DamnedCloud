// Pieces shared by the pending changes (ChangesScreen) and the "diff con develop" view (BaseDiffView).
import { useEffect, useState } from 'react'

// changeGroups labels are the IDE's English i18n keys: the ones its Italian locale translates
export const GROUP_LABELS: Record<string, string> = {
  Interfaces: 'Interfacce',
  Configuration: 'Configurazione',
  Documentation: 'Documentazione',
  Other: 'Altro'
}

/** `rel` (porcelain, '/') under `root`, with the separator of `root`. */
export function absPath(root: string, rel: string): string {
  const s = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${s}${rel.split('/').join(s)}`
}

/** Phone held sideways: little height, the selected change gets the whole screen. */
export const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 600px)'

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setOn(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return on
}
