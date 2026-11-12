import { create } from 'zustand'
import type { Captured } from './types'

export type PanelTab = 'outline' | 'notes' | 'mark' | 'stuck' | 'verify' | 'route'
export type ComposerMode = 'note' | 'stuck'

export interface DockState {
  title: string
  subtitle?: string
  text: string
  running: boolean
  error?: string
  model?: string
  noteId?: string
  /** 首字返回前显示的状态语，例如「正在联网检索…」 */
  thinking?: string
  /** 查证类回答：允许用户在结论上标「证实 / 未证实」 */
  allowVerdict?: boolean
  verdict?: 'ok' | 'unknown'
}

export interface ComposerState {
  mode: ComposerMode
  captured: Captured
  screen: { x: number; y: number }
}

interface UiStore {
  settingsOpen: boolean
  tab: PanelTab
  captured: Captured | null
  composer: ComposerState | null
  dock: DockState | null

  openSettings: () => void
  closeSettings: () => void
  setTab: (tab: PanelTab) => void
  setCaptured: (captured: Captured | null) => void
  openComposer: (composer: ComposerState) => void
  closeComposer: () => void
  openDock: (dock: DockState) => void
  patchDock: (patch: Partial<DockState>) => void
  appendDock: (text: string) => void
  closeDock: () => void
}

export const useUi = create<UiStore>()((set) => ({
  settingsOpen: false,
  tab: 'outline',
  captured: null,
  composer: null,
  dock: null,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setTab: (tab) => set({ tab }),
  setCaptured: (captured) => set({ captured }),
  openComposer: (composer) => set({ composer }),
  closeComposer: () => set({ composer: null }),
  openDock: (dock) => set({ dock }),
  patchDock: (patch) => set((s) => (s.dock ? { dock: { ...s.dock, ...patch } } : {})),
  appendDock: (text) => set((s) => (s.dock ? { dock: { ...s.dock, text: s.dock.text + text } } : {})),
  closeDock: () => set({ dock: null }),
}))
