import { create } from 'zustand'
import type { TabStatus, NormalizedEvent, EnrichedError, Message, TabState, Attachment, CatalogPlugin, PluginStatus, ClaudeProject, SessionMeta } from '../../shared/types'
import { useThemeStore } from '../theme'
import {
  AVAILABLE_MODELS,
  getEffectiveModel,
  getModelDisplayLabel,
  isKnownModelId,
} from '../models'
import notificationSrc from '../../../resources/notification.mp3'
import { clearPersistedTabs, loadTabHistory, saveOpenTabs } from '../tab-persistence'
import { loadSidebarState, saveSidebarState } from '../sidebar-persistence'

export { AVAILABLE_MODELS, getModelDisplayLabel, getEffectiveModel }

function resolveProjectPath(tab: TabState, homePath?: string): string {
  if (tab.workingDirectory && tab.workingDirectory !== '~') return tab.workingDirectory
  return homePath || '~'
}

async function persistSessionModel(tab: TabState, homePath?: string): Promise<void> {
  if (!tab.claudeSessionId || !tab.modelOverride) return
  const projectPath = resolveProjectPath(tab, homePath)
  await window.clui.setSessionModel(tab.claudeSessionId, projectPath, tab.modelOverride).catch(() => {})
}

async function loadSessionModelOverride(
  sessionId: string,
  projectPath: string,
): Promise<string | null> {
  const saved = await window.clui.getSessionModel(sessionId, projectPath).catch(() => null)
  return saved && isKnownModelId(saved) ? saved : null
}

// ─── Store ───

interface StaticInfo {
  version: string
  email: string | null
  subscriptionType: string | null
  projectPath: string
  homePath: string
}

interface State {
  tabs: TabState[]
  activeTabId: string
  /** Global expand/collapse — user-controlled, not per-tab */
  isExpanded: boolean
  /** Global info fetched on startup (not per-session) */
  staticInfo: StaticInfo | null
  /** Global permission mode: 'ask' shows cards, 'auto' auto-approves all tool calls */
  permissionMode: 'ask' | 'auto'

  /** Projects sidebar */
  sidebarOpen: boolean
  selectedProjectPath: string | null
  projects: ClaudeProject[]
  projectsLoading: boolean

  // Marketplace state
  marketplaceOpen: boolean
  marketplaceCatalog: CatalogPlugin[]
  marketplaceLoading: boolean
  marketplaceError: string | null
  marketplaceInstalledNames: string[]
  marketplacePluginStates: Record<string, PluginStatus>
  marketplaceSearch: string
  marketplaceFilter: string

  // Actions
  initStaticInfo: () => Promise<void>
  /** Load static info; start with no tabs until a project is chosen */
  initAndRestoreTabs: () => Promise<void>
  toggleSidebar: () => void
  loadProjects: () => Promise<void>
  renameProject: (projectPath: string, displayName: string | null) => Promise<void>
  deleteProject: (projectPath: string) => Promise<void>
  createProject: () => Promise<void>
  openProject: (projectPath: string) => Promise<void>
  closeAllTabs: () => Promise<void>
  deleteActiveSession: () => Promise<void>
  setTabModel: (modelId: string) => void
  setPermissionMode: (mode: 'ask' | 'auto') => void
  createTab: () => Promise<string>
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  ensureTabHistoryLoaded: (tabId: string) => Promise<void>
  clearTab: () => void
  toggleExpanded: () => void
  toggleMarketplace: () => void
  closeMarketplace: () => void
  loadMarketplace: (forceRefresh?: boolean) => Promise<void>
  setMarketplaceSearch: (query: string) => void
  setMarketplaceFilter: (filter: string) => void
  installMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  uninstallMarketplacePlugin: (plugin: CatalogPlugin) => Promise<void>
  buildYourOwn: () => void
  resumeSession: (sessionId: string, title?: string, projectPath?: string) => Promise<string>
  addSystemMessage: (content: string) => void
  sendMessage: (prompt: string, projectPath?: string) => void
  respondPermission: (tabId: string, questionId: string, optionId: string) => void
  addDirectory: (dir: string) => void
  removeDirectory: (dir: string) => void
  setBaseDirectory: (dir: string) => void
  addAttachments: (attachments: Attachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  handleNormalizedEvent: (tabId: string, event: NormalizedEvent) => void
  handleStatusChange: (tabId: string, newStatus: string, oldStatus: string) => void
  handleError: (tabId: string, error: EnrichedError) => void
}

let msgCounter = 0
const nextMsgId = () => `msg-${++msgCounter}`

// ─── Notification sound (plays when task completes while window is hidden) ───
const notificationAudio = new Audio(notificationSrc)
notificationAudio.volume = 1.0

async function playNotificationIfHidden(): Promise<void> {
  if (!useThemeStore.getState().soundEnabled) return
  try {
    const visible = await window.clui.isVisible()
    if (!visible) {
      notificationAudio.currentTime = 0
      notificationAudio.play().catch(() => {})
    }
  } catch {}
}

let tabPersistenceEnabled = false

function makeLocalTab(): TabState {
  return {
    id: crypto.randomUUID(),
    claudeSessionId: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    permissionQueue: [],
    permissionDenied: null,
    attachments: [],
    messages: [],
    title: 'New Tab',
    lastResult: null,
    sessionModel: null,
    modelOverride: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: [],
    historyLoaded: true,
    historyLoading: false,
  }
}

function sessionTabTitle(session: SessionMeta): string {
  if (session.slug) return session.slug
  if (session.firstMessage) {
    const t = session.firstMessage.trim()
    return t.length > 28 ? `${t.substring(0, 25)}...` : t
  }
  return 'Session'
}

async function createSessionTabStub(session: SessionMeta, projectPath: string): Promise<TabState> {
  const { tabId } = await window.clui.createTab()
  return {
    ...makeLocalTab(),
    id: tabId,
    claudeSessionId: session.sessionId,
    title: sessionTabTitle(session),
    workingDirectory: projectPath,
    hasChosenDirectory: true,
    historyLoaded: false,
    historyLoading: false,
    messages: [],
  }
}

async function createEmptyProjectTab(projectPath: string): Promise<TabState> {
  const { tabId } = await window.clui.createTab()
  return {
    ...makeLocalTab(),
    id: tabId,
    workingDirectory: projectPath,
    hasChosenDirectory: true,
    title: 'New Tab',
  }
}

export const useSessionStore = create<State>((set, get) => ({
  tabs: [],
  activeTabId: '',
  isExpanded: false,
  staticInfo: null,
  permissionMode: 'ask',
  sidebarOpen: false,
  selectedProjectPath: null,
  projects: [],
  projectsLoading: false,

  // Marketplace
  marketplaceOpen: false,
  marketplaceCatalog: [],
  marketplaceLoading: false,
  marketplaceError: null,
  marketplaceInstalledNames: [],
  marketplacePluginStates: {},
  marketplaceSearch: '',
  marketplaceFilter: 'All',

  initStaticInfo: async () => {
    try {
      const result = await window.clui.start()
      set({
        staticInfo: {
          version: result.version || 'unknown',
          email: result.auth?.email || null,
          subscriptionType: result.auth?.subscriptionType || null,
          projectPath: result.projectPath || '~',
          homePath: result.homePath || '~',
        },
      })
    } catch {}
  },

  initAndRestoreTabs: async () => {
    tabPersistenceEnabled = false
    clearPersistedTabs()
    await get().initStaticInfo()
    const sidebar = loadSidebarState()
    set({
      tabs: [],
      activeTabId: '',
      sidebarOpen: sidebar.open,
      selectedProjectPath: sidebar.selectedProjectPath,
    })
    await get().loadProjects()
    tabPersistenceEnabled = true
  },

  toggleSidebar: () => {
    const open = !get().sidebarOpen
    set({ sidebarOpen: open })
    saveSidebarState({ open, selectedProjectPath: get().selectedProjectPath })
    if (open) void get().loadProjects()
  },

  loadProjects: async () => {
    set({ projectsLoading: true })
    try {
      const projects = await window.clui.listProjects()
      set({ projects, projectsLoading: false })
    } catch {
      set({ projectsLoading: false })
    }
  },

  renameProject: async (projectPath, displayName) => {
    const ok = await window.clui.setProjectLabel(projectPath, displayName)
    if (!ok) return
    await get().loadProjects()
  },

  deleteProject: async (projectPath) => {
    const ok = await window.clui.deleteProject(projectPath).catch(() => false)
    if (!ok) return

    if (get().selectedProjectPath === projectPath) {
      tabPersistenceEnabled = false
      await get().closeAllTabs()
      clearPersistedTabs()
      set({
        selectedProjectPath: null,
        tabs: [],
        activeTabId: '',
        marketplaceOpen: false,
      })
      saveSidebarState({ open: get().sidebarOpen, selectedProjectPath: null })
      tabPersistenceEnabled = true
    }

    await get().loadProjects()
  },

  createProject: async () => {
    const dir = await window.clui.selectDirectory()
    if (!dir) return
    const ok = await window.clui.ensureProject(dir)
    if (!ok) return
    tabPersistenceEnabled = false
    await get().closeAllTabs()
    const tab = await createEmptyProjectTab(dir)
    set({
      selectedProjectPath: dir,
      tabs: [tab],
      activeTabId: tab.id,
      isExpanded: true,
      marketplaceOpen: false,
      sidebarOpen: true,
    })
    saveSidebarState({ open: true, selectedProjectPath: dir })
    await get().loadProjects()
    tabPersistenceEnabled = true
    saveOpenTabs([tab], tab.id)
  },

  closeAllTabs: async () => {
    const ids = get().tabs.map((t) => t.id)
    await Promise.all(ids.map((id) => window.clui.closeTab(id).catch(() => {})))
    set({ tabs: [], activeTabId: '' })
  },

  openProject: async (projectPath) => {
    tabPersistenceEnabled = false
    await get().closeAllTabs()
    const sessions = await window.clui.listSessions(projectPath)
    const tabs: TabState[] = []
    if (sessions.length === 0) {
      tabs.push(await createEmptyProjectTab(projectPath))
    } else {
      const stubs = await Promise.all(
        sessions.map((session) => createSessionTabStub(session, projectPath)),
      )
      tabs.push(...stubs)
    }
    const activeTabId = tabs[0]?.id ?? ''
    set({
      selectedProjectPath: projectPath,
      tabs,
      activeTabId,
      isExpanded: true,
      marketplaceOpen: false,
    })
    saveSidebarState({ open: get().sidebarOpen, selectedProjectPath: projectPath })
    tabPersistenceEnabled = true
    if (tabs.length > 0) saveOpenTabs(tabs, activeTabId)
    if (activeTabId) void get().ensureTabHistoryLoaded(activeTabId)
  },

  ensureTabHistoryLoaded: async (tabId) => {
    const { tabs, selectedProjectPath } = get()
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || tab.historyLoaded || tab.historyLoading || !tab.claudeSessionId) return

    const projectPath =
      tab.workingDirectory && tab.workingDirectory !== '~'
        ? tab.workingDirectory
        : selectedProjectPath
    if (!projectPath?.startsWith('/')) {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, historyLoaded: true, historyLoading: false } : t,
        ),
      }))
      return
    }

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, historyLoading: true } : t,
      ),
    }))

    try {
      const [messages, modelOverride] = await Promise.all([
        loadTabHistory(tab.claudeSessionId, projectPath),
        loadSessionModelOverride(tab.claudeSessionId, projectPath),
      ])
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                messages,
                modelOverride: modelOverride ?? t.modelOverride,
                historyLoaded: true,
                historyLoading: false,
              }
            : t,
        ),
      }))
    } catch {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, historyLoaded: true, historyLoading: false } : t,
        ),
      }))
    }
  },

  deleteActiveSession: async () => {
    const { activeTabId, tabs, selectedProjectPath } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    const projectPath =
      tab.workingDirectory && tab.workingDirectory !== '~'
        ? tab.workingDirectory
        : selectedProjectPath
    if (tab.claudeSessionId && projectPath?.startsWith('/')) {
      await window.clui.deleteSession(tab.claudeSessionId, projectPath).catch(() => {})
    }
    get().closeTab(activeTabId)
    void get().loadProjects()
  },

  setTabModel: (modelId) => {
    if (!isKnownModelId(modelId)) return
    const { activeTabId, staticInfo } = get()
    let updatedTab: TabState | null = null
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== activeTabId) return t
        updatedTab = { ...t, modelOverride: modelId }
        return updatedTab
      }),
    }))
    if (updatedTab) void persistSessionModel(updatedTab, staticInfo?.homePath)
  },

  setPermissionMode: (mode) => {
    set({ permissionMode: mode })
    window.clui.setPermissionMode(mode)
  },

  createTab: async () => {
    const projectPath = get().selectedProjectPath
    if (!projectPath) return ''
    try {
      const tab = await createEmptyProjectTab(projectPath)
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        isExpanded: true,
      }))
      if (tabPersistenceEnabled) saveOpenTabs(get().tabs, tab.id)
      return tab.id
    } catch {
      return ''
    }
  },

  selectTab: (tabId) => {
    const s = get()
    if (tabId === s.activeTabId) {
      // Clicking the already-active tab: toggle global expand/collapse
      const willExpand = !s.isExpanded
      set((prev) => ({
        isExpanded: willExpand,
        marketplaceOpen: false,
        // Expanding = reading: clear unread flag
        tabs: willExpand
          ? prev.tabs.map((t) => t.id === tabId ? { ...t, hasUnread: false } : t)
          : prev.tabs,
      }))
    } else {
      // Switching to a different tab: mark as read
      set((prev) => ({
        activeTabId: tabId,
        marketplaceOpen: false,
        tabs: prev.tabs.map((t) =>
          t.id === tabId ? { ...t, hasUnread: false } : t
        ),
      }))
      void get().ensureTabHistoryLoaded(tabId)
    }
  },

  toggleExpanded: () => {
    const { activeTabId, isExpanded } = get()
    const willExpand = !isExpanded
    set((s) => ({
      isExpanded: willExpand,
      marketplaceOpen: false,
      // Expanding = reading: clear unread flag for the active tab
      tabs: willExpand
        ? s.tabs.map((t) => t.id === activeTabId ? { ...t, hasUnread: false } : t)
        : s.tabs,
    }))
  },

  toggleMarketplace: () => {
    const s = get()
    if (s.marketplaceOpen) {
      set({ marketplaceOpen: false })
    } else {
      set({ isExpanded: false, marketplaceOpen: true })
      get().loadMarketplace()
    }
  },

  closeMarketplace: () => {
    set({ marketplaceOpen: false })
  },

  loadMarketplace: async (forceRefresh) => {
    set({ marketplaceLoading: true, marketplaceError: null })
    try {
      const [catalog, installed] = await Promise.all([
        window.clui.fetchMarketplace(forceRefresh),
        window.clui.listInstalledPlugins(),
      ])
      if (catalog.error && catalog.plugins.length === 0) {
        set({ marketplaceError: catalog.error, marketplaceLoading: false })
        return
      }
      const installedSet = new Set(installed.map((n) => n.toLowerCase()))
      const pluginStates: Record<string, PluginStatus> = {}
      for (const p of catalog.plugins) {
        // For SKILL.md skills: match individual name against ~/.claude/skills/ dirs
        // For CLI plugins: match installName or "installName@marketplace" against installed_plugins.json
        const candidates = p.isSkillMd
          ? [p.installName]
          : [p.installName, `${p.installName}@${p.marketplace}`]
        const isInstalled = candidates.some((c) => installedSet.has(c.toLowerCase()))
        pluginStates[p.id] = isInstalled ? 'installed' : 'not_installed'
      }
      set({
        marketplaceCatalog: catalog.plugins,
        marketplaceInstalledNames: installed,
        marketplacePluginStates: pluginStates,
        marketplaceLoading: false,
      })
    } catch (err: unknown) {
      set({
        marketplaceError: err instanceof Error ? err.message : String(err),
        marketplaceLoading: false,
      })
    }
  },

  setMarketplaceSearch: (query) => {
    set({ marketplaceSearch: query })
  },

  setMarketplaceFilter: (filter) => {
    set({ marketplaceFilter: filter })
  },

  installMarketplacePlugin: async (plugin) => {
    set((s) => ({
      marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installing' },
    }))
    const result = await window.clui.installPlugin(plugin.repo, plugin.installName, plugin.marketplace, plugin.sourcePath, plugin.isSkillMd)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'installed' as PluginStatus },
        marketplaceInstalledNames: [...s.marketplaceInstalledNames, plugin.installName],
      }))
    } else {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'failed' },
      }))
    }
  },

  uninstallMarketplacePlugin: async (plugin) => {
    const result = await window.clui.uninstallPlugin(plugin.installName)
    if (result.ok) {
      set((s) => ({
        marketplacePluginStates: { ...s.marketplacePluginStates, [plugin.id]: 'not_installed' as PluginStatus },
        marketplaceInstalledNames: s.marketplaceInstalledNames.filter((n) => n !== plugin.installName),
      }))
    }
  },

  buildYourOwn: () => {
    set({ marketplaceOpen: false, isExpanded: true })
    // Small delay to let the UI transition
    setTimeout(() => {
      get().sendMessage('Help me create a new Claude Code skill')
    }, 100)
  },

  closeTab: (tabId) => {
    window.clui.closeTab(tabId).catch(() => {})

    const s = get()
    const remaining = s.tabs.filter((t) => t.id !== tabId)

    if (s.activeTabId === tabId) {
      if (remaining.length === 0) {
        set({ tabs: [], activeTabId: '' })
        clearPersistedTabs()
        return
      }
      const closedIndex = s.tabs.findIndex((t) => t.id === tabId)
      const newActive = remaining[Math.min(closedIndex, remaining.length - 1)]
      set({ tabs: remaining, activeTabId: newActive.id })
    } else {
      set({ tabs: remaining })
    }
  },

  clearTab: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, messages: [], lastResult: null, currentActivity: '', permissionQueue: [], permissionDenied: null, queuedPrompts: [] }
          : t
      ),
    }))
  },

  resumeSession: async (sessionId, title, projectPath) => {
    const defaultDir = projectPath || get().staticInfo?.homePath || '~'
    try {
      const { tabId } = await window.clui.createTab()

      // Load previous conversation messages from the JSONL file
      const history = await window.clui.loadSession(sessionId, defaultDir).catch(() => [])
      const messages: Message[] = history.map((m) => ({
        id: nextMsgId(),
        role: m.role as Message['role'],
        content: m.content,
        toolName: m.toolName,
        toolStatus: m.toolName ? 'completed' as const : undefined,
        timestamp: m.timestamp,
      }))

      const savedModel = await loadSessionModelOverride(sessionId, defaultDir)
      const tab: TabState = {
        ...makeLocalTab(),
        id: tabId,
        claudeSessionId: sessionId,
        title: title || 'Resumed Session',
        workingDirectory: defaultDir,
        hasChosenDirectory: !!projectPath,
        messages,
        modelOverride: savedModel,
        historyLoaded: true,
        historyLoading: false,
      }
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        isExpanded: true,
      }))
      // Don't call initSession — the first real prompt will use --resume with the sessionId
      return tabId
    } catch {
      const savedModel = await loadSessionModelOverride(sessionId, defaultDir).catch(() => null)
      const tab = makeLocalTab()
      tab.claudeSessionId = sessionId
      tab.title = title || 'Resumed Session'
      tab.workingDirectory = defaultDir
      tab.hasChosenDirectory = !!projectPath
      tab.modelOverride = savedModel
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        isExpanded: true,
      }))
      return tab.id
    }
  },

  addSystemMessage: (content) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: nextMsgId(), role: 'system' as const, content, timestamp: Date.now() },
              ],
            }
          : t
      ),
    }))
  },

  // ─── Permission response ───

  respondPermission: (tabId, questionId, optionId) => {
    // Send to backend
    window.clui.respondPermission(tabId, questionId, optionId).catch(() => {})

    // Remove answered item from queue; show next tool's activity or clear
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const remaining = t.permissionQueue.filter((p) => p.questionId !== questionId)
        return {
          ...t,
          permissionQueue: remaining,
          currentActivity: remaining.length > 0
            ? `Waiting for permission: ${remaining[0].toolTitle}`
            : 'Working...',
        }
      }),
    }))
  },

  // ─── Directory management ───

  addDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              additionalDirs: t.additionalDirs.includes(dir)
                ? t.additionalDirs
                : [...t.additionalDirs, dir],
            }
          : t
      ),
    }))
  },

  removeDirectory: (dir) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, additionalDirs: t.additionalDirs.filter((d) => d !== dir) }
          : t
      ),
    }))
  },

  setBaseDirectory: (dir) => {
    const { activeTabId } = get()
    window.clui.resetTabSession(activeTabId)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? {
              ...t,
              workingDirectory: dir,
              hasChosenDirectory: true,
              claudeSessionId: null,
              modelOverride: null,
              additionalDirs: [],
            }
          : t
      ),
    }))
  },

  // ─── Attachment management ───

  addAttachments: (attachments) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: [...t.attachments, ...attachments] }
          : t
      ),
    }))
  },

  removeAttachment: (attachmentId) => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId
          ? { ...t, attachments: t.attachments.filter((a) => a.id !== attachmentId) }
          : t
      ),
    }))
  },

  clearAttachments: () => {
    const { activeTabId } = get()
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === activeTabId ? { ...t, attachments: [] } : t
      ),
    }))
  },

  // ─── Send ───

  sendMessage: (prompt, projectPath) => {
    const { activeTabId, tabs, staticInfo } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    // Use explicitly chosen directory, otherwise fall back to user home
    const resolvedPath = projectPath || (tab?.hasChosenDirectory ? tab.workingDirectory : (staticInfo?.homePath || tab?.workingDirectory || '~'))
    if (!tab) return

    // Guard: don't send while connecting (warmup in progress)
    if (tab.status === 'connecting') return

    const isBusy = tab.status === 'running'
    const requestId = crypto.randomUUID()

    // Build full prompt with attachment context
    let fullPrompt = prompt
    if (tab.attachments.length > 0) {
      const attachmentCtx = tab.attachments
        .map((a) => `[Attached ${a.type}: ${a.path}]`)
        .join('\n')
      fullPrompt = `${attachmentCtx}\n\n${prompt}`
    }

    const title = tab.messages.length === 0
      ? (prompt.length > 30 ? prompt.substring(0, 27) + '...' : prompt)
      : tab.title

    // Optimistic update: clear attachments
    // If busy, add to queuedPrompts (shown at bottom); otherwise add to messages and set connecting
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== activeTabId) return t
        const withEffectiveBase = t.hasChosenDirectory
          ? t
          : {
              ...t,
              // Once the user sends the first message, lock in the effective
              // base directory (home by default) so the footer no longer shows "—".
              hasChosenDirectory: true,
              workingDirectory: resolvedPath,
            }
        if (isBusy) {
          return {
            ...withEffectiveBase,
            title,
            attachments: [],
            queuedPrompts: [...withEffectiveBase.queuedPrompts, prompt],
          }
        }
        return {
          ...withEffectiveBase,
          status: 'connecting' as TabStatus,
          activeRequestId: requestId,
          currentActivity: 'Starting...',
          title,
          attachments: [],
          messages: [
            ...withEffectiveBase.messages,
            { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now() },
          ],
        }
      }),
    }))

    // Send to backend — ControlPlane will queue if a run is active
    const defaultModel = useThemeStore.getState().defaultModel
    const model = getEffectiveModel(tab, defaultModel)
    window.clui.prompt(activeTabId, requestId, {
      prompt: fullPrompt,
      projectPath: resolvedPath,
      sessionId: tab.claudeSessionId || undefined,
      model,
      addDirs: tab.additionalDirs.length > 0 ? tab.additionalDirs : undefined,
    }).catch((err: Error) => {
      get().handleError(activeTabId, {
        message: err.message,
        stderrTail: [],
        exitCode: null,
        elapsedMs: 0,
        toolCallCount: 0,
      })
    })
  },

  // ─── Event handlers ───

  handleNormalizedEvent: (tabId, event) => {
    set((s) => {
      const { activeTabId } = s
      const tabs = s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        const updated = { ...tab }

        switch (event.type) {
          case 'session_init': {
            updated.claudeSessionId = event.sessionId
            updated.sessionModel = event.model
            updated.sessionTools = event.tools
            updated.sessionMcpServers = event.mcpServers
            updated.sessionSkills = event.skills
            updated.sessionVersion = event.version
            const tabSnapshot = { ...updated }
            if (updated.modelOverride) {
              void persistSessionModel(tabSnapshot, s.staticInfo?.homePath)
            } else {
              void loadSessionModelOverride(event.sessionId, resolveProjectPath(tabSnapshot, s.staticInfo?.homePath))
                .then((savedModel) => {
                  if (!savedModel) return
                  useSessionStore.setState((state) => ({
                    tabs: state.tabs.map((t) =>
                      t.id === tabId && !t.modelOverride ? { ...t, modelOverride: savedModel } : t,
                    ),
                  }))
                })
            }
            // Don't change status/activity for warmup inits — they're invisible
            if (!event.isWarmup) {
              updated.status = 'running'
              updated.currentActivity = 'Thinking...'
              // Move the first queued prompt into the timeline (it's now being processed)
              if (updated.queuedPrompts.length > 0) {
                const [nextPrompt, ...rest] = updated.queuedPrompts
                updated.queuedPrompts = rest
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'user' as const, content: nextPrompt, timestamp: Date.now() },
                ]
              }
            }
            break
          }

          case 'text_chunk': {
            updated.currentActivity = 'Writing...'
            const lastMsg = updated.messages[updated.messages.length - 1]
            if (lastMsg?.role === 'assistant' && !lastMsg.toolName) {
              updated.messages = [
                ...updated.messages.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + event.text },
              ]
            } else {
              updated.messages = [
                ...updated.messages,
                { id: nextMsgId(), role: 'assistant', content: event.text, timestamp: Date.now() },
              ]
            }
            break
          }

          case 'tool_call':
            updated.currentActivity = `Running ${event.toolName}...`
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'tool',
                content: '',
                toolName: event.toolName,
                toolInput: '',
                toolStatus: 'running',
                timestamp: Date.now(),
              },
            ]
            break

          case 'tool_call_update': {
            const msgs = [...updated.messages]
            const lastTool = [...msgs].reverse().find((m) => m.role === 'tool' && m.toolStatus === 'running')
            if (lastTool) {
              lastTool.toolInput = (lastTool.toolInput || '') + event.partialInput
            }
            updated.messages = msgs
            break
          }

          case 'tool_call_complete': {
            const msgs2 = [...updated.messages]
            const runningTool = [...msgs2].reverse().find((m) => m.role === 'tool' && m.toolStatus === 'running')
            if (runningTool) {
              runningTool.toolStatus = 'completed'
            }
            updated.messages = msgs2
            break
          }

          case 'task_update': {
            // ── Text fallback ──
            // text_chunk events (from stream_event deltas) are the primary render path.
            // If they didn't arrive for this run (timing, partial stream, etc.), the
            // assembled assistant event still has the full text — extract it here.
            // "This run" = everything after the last user message.
            if (event.message?.content) {
              const lastUserIdx = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasStreamedText = updated.messages
                .slice(lastUserIdx + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)

              if (!hasStreamedText) {
                const textContent = event.message.content
                  .filter((b) => b.type === 'text' && b.text)
                  .map((b) => b.text!)
                  .join('')
                if (textContent) {
                  updated.messages = [
                    ...updated.messages,
                    { id: nextMsgId(), role: 'assistant' as const, content: textContent, timestamp: Date.now() },
                  ]
                }
              }

              // ── Tool card deduplication (unchanged) ──
              for (const block of event.message.content) {
                if (block.type === 'tool_use' && block.name) {
                  const exists = updated.messages.find(
                    (m) => m.role === 'tool' && m.toolName === block.name && !m.content
                  )
                  if (!exists) {
                    updated.messages = [
                      ...updated.messages,
                      {
                        id: nextMsgId(),
                        role: 'tool',
                        content: '',
                        toolName: block.name,
                        toolInput: JSON.stringify(block.input, null, 2),
                        toolStatus: 'completed',
                        timestamp: Date.now(),
                      },
                    ]
                  }
                }
              }
            }
            break
          }

          case 'task_complete':
            updated.status = 'completed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.lastResult = {
              totalCostUsd: event.costUsd,
              durationMs: event.durationMs,
              numTurns: event.numTurns,
              usage: event.usage,
              sessionId: event.sessionId,
            }
            // ── Final text fallback ──
            // If neither text_chunks nor task_update text produced an assistant message,
            // use event.result (the CLI's assembled final output) as last resort.
            if (event.result) {
              const lastUserIdx2 = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i--) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasAnyText = updated.messages
                .slice(lastUserIdx2 + 1)
                .some((m) => m.role === 'assistant' && !m.toolName)
              if (!hasAnyText) {
                updated.messages = [
                  ...updated.messages,
                  { id: nextMsgId(), role: 'assistant' as const, content: event.result, timestamp: Date.now() },
                ]
              }
            }
            // Mark as unread unless the user is actively viewing this tab
            // (active tab with card expanded). A collapsed active tab still
            // counts as "unread" — the user hasn't seen the response yet.
            if (tabId !== activeTabId || !s.isExpanded) {
              updated.hasUnread = true
            }
            // Show fallback card when tools were denied by permission settings
            if (event.permissionDenials && event.permissionDenials.length > 0) {
              updated.permissionDenied = { tools: event.permissionDenials }
            } else {
              updated.permissionDenied = null
            }
            // Play notification sound if window is hidden
            playNotificationIfHidden()
            break

          case 'error': {
            updated.status = 'failed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.permissionDenied = null
            const last = updated.messages[updated.messages.length - 1]
            const limitAlreadyShown =
              last?.role === 'assistant' &&
              /session limit|rate limit|usage limit/i.test(last.content)
            if (!limitAlreadyShown) {
              updated.messages = [
                ...updated.messages,
                {
                  id: nextMsgId(),
                  role: 'system',
                  content: event.message.startsWith('Error:')
                    ? event.message
                    : `Error: ${event.message}`,
                  timestamp: Date.now(),
                },
              ]
            }
            break
          }

          case 'session_dead':
            updated.status = 'dead'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.permissionQueue = []
            updated.permissionDenied = null
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Session ended unexpectedly (exit ${event.exitCode})`,
                timestamp: Date.now(),
              },
            ]
            break

          case 'permission_request': {
            const newReq: import('../../shared/types').PermissionRequest = {
              questionId: event.questionId,
              toolTitle: event.toolName,
              toolDescription: event.toolDescription,
              toolInput: event.toolInput,
              options: event.options.map((o) => ({
                optionId: o.id,
                kind: o.kind,
                label: o.label,
              })),
            }
            updated.permissionQueue = [...updated.permissionQueue, newReq]
            updated.currentActivity = `Waiting for permission: ${event.toolName}`
            break
          }

          case 'rate_limit': {
            if (event.status !== 'allowed') {
              const lastRl = updated.messages[updated.messages.length - 1]
              const limitAlreadyShown =
                lastRl?.role === 'assistant' &&
                /session limit|rate limit|usage limit/i.test(lastRl.content)
              if (!limitAlreadyShown) {
                const resetHint =
                  event.resetsAt > 0
                    ? ` Resets at ${new Date(event.resetsAt).toLocaleTimeString()}.`
                    : ''
                updated.messages = [
                  ...updated.messages,
                  {
                    id: nextMsgId(),
                    role: 'system',
                    content: `Rate limited (${event.rateLimitType}).${resetHint}`,
                    timestamp: Date.now(),
                  },
                ]
              }
            }
            break
          }
        }

        return updated
      })

      return { tabs }
    })
  },

  handleStatusChange: (tabId, newStatus) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              status: newStatus as TabStatus,
              // Clear activity when transitioning to idle (e.g., after warmup init)
              ...(newStatus === 'idle' ? { currentActivity: '', permissionQueue: [] as import('../../shared/types').PermissionRequest[], permissionDenied: null } : {}),
            }
          : t
      ),
    }))
  },

  handleError: (tabId, error) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t

        // Deduplicate: skip if the last message is already an error for this failure
        const lastMsg = t.messages[t.messages.length - 1]
        const alreadyHasError = lastMsg?.role === 'system' && lastMsg.content.startsWith('Error:')

        return {
          ...t,
          status: 'failed' as TabStatus,
          activeRequestId: null,
          currentActivity: '',
          permissionQueue: [],
          messages: alreadyHasError
            ? t.messages
            : [
                ...t.messages,
                {
                  id: nextMsgId(),
                  role: 'system' as const,
                  content: `Error: ${error.message}${error.stderrTail.length > 0 ? '\n\n' + error.stderrTail.slice(-5).join('\n') : ''}`,
                  timestamp: Date.now(),
                },
              ],
        }
      }),
    }))
  },
}))

// Persist open tabs on every change; closed tabs are omitted automatically.
useSessionStore.subscribe((state) => {
  if (!tabPersistenceEnabled) return
  if (state.tabs.length === 0) {
    clearPersistedTabs()
    return
  }
  saveOpenTabs(state.tabs, state.activeTabId)
})
