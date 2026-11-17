import { useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Boxes, GitBranch, Rocket, Code2, Database, Settings, RefreshCw, WifiOff } from 'lucide-react'
import { useRemoteStore } from './lib/store'
import { useNavStore, type Tab } from './lib/nav'
import { applyTheme } from './lib/theme'
import { PairingScreen } from './screens/PairingScreen'
import { WorktreesScreen } from './screens/WorktreesScreen'
import { ChangesScreen } from './screens/ChangesScreen'
import { ReleaseScreen } from './screens/ReleaseScreen'
import { EditorScreen } from './screens/EditorScreen'
import { SqlScreen } from './screens/SqlScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { UpdateBanner } from './components/UpdateBanner'
import { useUpdateStore } from './lib/update'

const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: 'worktrees', label: 'Worktree', icon: Boxes },
  { id: 'changes', label: 'Modifiche', icon: GitBranch },
  { id: 'release', label: 'Rilascio', icon: Rocket },
  { id: 'editor', label: 'Editor', icon: Code2 },
  { id: 'sql', label: 'SQL', icon: Database },
  { id: 'settings', label: 'Impostazioni', icon: Settings }
]

export default function App() {
  const booted = useRemoteStore((s) => s.booted)
  const token = useRemoteStore((s) => s.token)
  const device = useRemoteStore((s) => s.device)
  const status = useRemoteStore((s) => s.status)
  const detail = useRemoteStore((s) => s.detail)
  const pairing = useRemoteStore((s) => s.pairing)
  const pairingCode = useRemoteStore((s) => s.pairingCode)
  const load = useRemoteStore((s) => s.load)
  const connect = useRemoteStore((s) => s.connect)
  const resume = useRemoteStore((s) => s.resume)
  const openPairingLink = useRemoteStore((s) => s.openPairingLink)
  const theme = useRemoteStore((s) => s.workspace?.theme)
  const tab = useNavStore((s) => s.tab)
  const setTab = useNavStore((s) => s.setTab)
  const tabRef = useRef(tab)
  tabRef.current = tab
  // Errors of a deep-link pairing or a manual reconnect while the tabs are shown
  // (the PairingScreen shows the store error itself).
  const [bannerError, setBannerError] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    load()
    void useUpdateStore.getState().check()
    const openLink = (url: string) => {
      setBannerError(null)
      void openPairingLink(url).catch((e) => setBannerError((e as Error).message || 'associazione fallita'))
    }
    const listeners = [
      // Capacitor retains the launch intent and hands it to the first listener,
      // so appUrlOpen alone covers both a cold start and a running app.
      CapApp.addListener('appUrlOpen', ({ url }) => openLink(url)),
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          resume()
          void useUpdateStore.getState().check()
        }
      }),
      CapApp.addListener('backButton', () => {
        if (tabRef.current !== TABS[0].id) setTab(TABS[0].id)
        else void CapApp.minimizeApp()
      })
    ]
    if (!Capacitor.isNativePlatform()) {
      // Web build: the payload rides in the URL; clear it so a reload does not pair again.
      const fromLocation = window.location.hash || window.location.search
      if (fromLocation) {
        window.history.replaceState(null, '', window.location.pathname)
        openLink(fromLocation)
      }
    }
    return () => {
      for (const listener of listeners) void listener.then((l) => l.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Looks like the IDE: its theme and primary color, the last one seen while offline.
  useEffect(() => applyTheme(theme), [theme?.mode, theme?.accent])

  // A new session supersedes whatever the banner was reporting.
  useEffect(() => setBannerError(null), [token])

  const reconnect = async () => {
    setReconnecting(true)
    setBannerError(null)
    try {
      await connect()
    } catch (e) {
      setBannerError((e as Error).message || 'connessione fallita')
    } finally {
      setReconnecting(false)
    }
  }

  if (!booted) {
    return (
      <div className="app">
        <div className="center-screen">
          <div className="logo">DAMNEDCLOUD</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <span className="spinner" />
          </div>
        </div>
      </div>
    )
  }

  if (!token || !device) {
    return (
      <div className="app">
        <div style={{ padding: '10px 12px 0' }}><UpdateBanner /></div>
        <PairingScreen />
      </div>
    )
  }

  return (
    <div className="app">
      {pairing ? (
        <div className="conn-banner info">
          <span className="spinner" />
          <span className="grow">{pairingCode ? `Conferma sul PC: codice ${pairingCode}` : 'Conferma l’associazione su DamnedIDE'}</span>
        </div>
      ) : status !== 'open' ? (
        <div className="conn-banner">
          {status === 'connecting' || reconnecting ? <span className="spinner" /> : <WifiOff size={15} />}
          <span className="grow">
            {status === 'connecting' ? 'Connessione al desktop…' : 'Non connesso al desktop'}
            {detail ? ` · ${detail}` : ''}
          </span>
          {status !== 'connecting' && (
            <button className="btn small" onClick={() => void reconnect()} disabled={reconnecting}>
              <RefreshCw size={13} /> riconnetti
            </button>
          )}
        </div>
      ) : null}
      <div className="content">
        <UpdateBanner />
        {bannerError && (
          <div className="error-banner" onClick={() => setBannerError(null)}>
            {bannerError}
          </div>
        )}
        {tab === 'worktrees' && <WorktreesScreen />}
        {tab === 'changes' && <ChangesScreen />}
        {tab === 'release' && <ReleaseScreen />}
        {tab === 'editor' && <EditorScreen />}
        {tab === 'sql' && <SqlScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </div>
      <nav className="tabbar">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
