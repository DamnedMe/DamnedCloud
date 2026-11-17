import { create } from 'zustand'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { APK_DOWNLOAD_URL, APP_LATEST_RELEASE_API } from '../shared/remote/protocol'
import { isNewer } from './version'

export interface AppUpdate {
  current: string
  latest: string
}

/**
 * The APK checks the latest GitHub release against its own version. The webapp never does: it is
 * the build shipped with DamnedIDE and follows the IDE (see `reloadOnIdeUpdate` in the store).
 */
export async function checkAppUpdate(): Promise<AppUpdate | null> {
  if (!Capacitor.isNativePlatform()) return null
  const { version: current } = await CapApp.getInfo()
  const res = await fetch(APP_LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const { tag_name: tag } = (await res.json()) as { tag_name?: string }
  if (!tag) return null
  const latest = tag.replace(/^v/, '')
  return isNewer(latest, current) ? { current, latest } : null
}

/**
 * Hands the APK download to the system browser (Capacitor opens other hosts outside the app);
 * Android then offers to install it over this version, data kept (same signing key).
 * ponytail: browser download + system installer; an in-app download needs a native plugin.
 */
export function installAppUpdate(): void {
  window.location.href = APK_DOWNLOAD_URL
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

interface UpdateState {
  update: AppUpdate | null
  checking: boolean
  checkedAt: number
  error: string | null
  dismissed: boolean
  /** On start and resume (at most every 6 hours), or `force` from Impostazioni. */
  check: (force?: boolean) => Promise<void>
  dismiss: () => void
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  update: null,
  checking: false,
  checkedAt: 0,
  error: null,
  dismissed: false,
  check: async (force = false) => {
    const { checking, checkedAt } = get()
    if (checking || (!force && Date.now() - checkedAt < CHECK_EVERY_MS)) return
    set({ checking: true, error: null })
    try {
      const update = await checkAppUpdate()
      set({ update, checkedAt: Date.now(), dismissed: force ? false : get().dismissed })
    } catch (e) {
      set({ error: (e as Error).message || 'verifica non riuscita', checkedAt: Date.now() })
    } finally {
      set({ checking: false })
    }
  },
  dismiss: () => set({ dismissed: true })
}))
