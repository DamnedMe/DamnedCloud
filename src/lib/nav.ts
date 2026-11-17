import { create } from 'zustand'

export type Tab = 'worktrees' | 'changes' | 'release' | 'editor' | 'sql' | 'settings'

/** A file the Editor tab must open, scrolled to `line` (1-based). */
export interface EditorTarget {
  file: string
  line: number
}

interface NavState {
  tab: Tab
  editorTarget: EditorTarget | null
  setTab: (tab: Tab) => void
  /** Switches to the Editor tab on `file` at `line`. */
  openInEditor: (file: string, line: number) => void
  clearEditorTarget: () => void
}

export const useNavStore = create<NavState>((set) => ({
  tab: 'worktrees',
  editorTarget: null,
  setTab: (tab) => set({ tab }),
  openInEditor: (file, line) => set({ tab: 'editor', editorTarget: { file, line } }),
  clearEditorTarget: () => set({ editorTarget: null })
}))
