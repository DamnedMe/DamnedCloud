import { Download, X } from 'lucide-react'
import { installAppUpdate, useUpdateStore } from '../lib/update'

/** Offers a newer APK (lib/update.ts); hidden in the webapp, which follows DamnedIDE. */
export function UpdateBanner() {
  const { update, dismissed, dismiss } = useUpdateStore()
  if (!update || dismissed) return null
  return (
    <div className="update-banner">
      <Download size={15} color="var(--accent)" />
      <span>DamnedCloud {update.latest} disponibile (hai la {update.current})</span>
      <button className="btn small primary" onClick={installAppUpdate}>aggiorna</button>
      <button className="btn small" onClick={dismiss} aria-label="Più tardi">
        <X size={13} />
      </button>
    </div>
  )
}
