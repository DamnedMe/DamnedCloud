import { useEffect, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { Boxes, GitBranch, Code2, Database, Settings } from 'lucide-react'
import { useRemoteStore } from './lib/store'
import { PairingScreen } from './screens/PairingScreen'
import { WorktreesScreen } from './screens/WorktreesScreen'
import { ChangesScreen } from './screens/ChangesScreen'
import { EditorScreen } from './screens/EditorScreen'
import { SqlScreen } from './screens/SqlScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type Tab = 'worktrees' | 'changes' | 'editor' | 'sql' | 'settings'

const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: 'worktrees', label: 'Worktree', icon: Boxes },
  { id: 'changes', label: 'Modifiche', icon: GitBranch },
  { id: 'editor', label: 'Editor', icon: Code2 },
  { id: 'sql', label: 'SQL', icon: Database },
  { id: 'settings', label: 'Impostazioni', icon: Settings }
]

export default function App() {
  const booted = useRemoteStore((s) => s.booted)
  const token = useRemoteStore((s) => s.token)
  const device = useRemoteStore((s) => s.device)
  const load = useRemoteStore((s) => s.load)
  const pairWithCode = useRemoteStore((s) => s.pairWithCode)
  const [tab, setTab] = useState<Tab>('worktrees')
  const [pairInput, setPairInput] = useState<string | null>(null)

  useEffect(() => {
    load()
    const fromLocation = window.location.hash || window.location.search
    if (fromLocation) setPairInput(fromLocation)
    const listener = CapApp.addListener('appUrlOpen', ({ url }) => setPairInput(url))
    CapApp.getLaunchUrl().then((res) => {
      if (res?.url) setPairInput(res.url)
    }).catch(() => { /* web */ })
    return () => {
      void listener.then((l) => l.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!pairInput) return
    const input = pairInput
    setPairInput(null)
    void pairWithCode(input).catch(() => { /* PairingScreen shows the error */ })
  }, [pairInput, pairWithCode])

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
        <PairingScreen />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="content">
        {tab === 'worktrees' && <WorktreesScreen />}
        {tab === 'changes' && <ChangesScreen />}
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
