const SIDEBAR_KEY = 'clui-sidebar'

export interface PersistedSidebarState {
  open: boolean
  selectedProjectPath: string | null
}

export function loadSidebarState(): PersistedSidebarState {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    if (!raw) return { open: false, selectedProjectPath: null }
    const parsed = JSON.parse(raw)
    return {
      open: !!parsed.open,
      selectedProjectPath:
        typeof parsed.selectedProjectPath === 'string' ? parsed.selectedProjectPath : null,
    }
  } catch {
    return { open: false, selectedProjectPath: null }
  }
}

export function saveSidebarState(state: PersistedSidebarState): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, JSON.stringify(state))
  } catch {}
}
