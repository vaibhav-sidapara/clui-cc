import React, { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Folder, CaretLeft, CaretRight, CaretDown, CaretUp, Plus, PencilSimple, Trash } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../theme'
import { slideTransition, slideTransitionFast } from '../motion'
import { ConfirmDialog } from './ConfirmDialog'
import type { ClaudeProject } from '../../shared/types'

const SIDEBAR_WIDTH = 176

function defaultProjectName(path: string): string {
  const parts = path.replace(/\/$/, '').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

function projectDisplayName(project: ClaudeProject): string {
  return project.displayName?.trim() || defaultProjectName(project.path)
}

function formatAgo(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ChatCollapseButton() {
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const toggleExpanded = useSessionStore((s) => s.toggleExpanded)
  const colors = useColors()

  return (
    <button
      type="button"
      data-clui-ui
      onClick={() => toggleExpanded()}
      className="clui-pointer flex items-center justify-center rounded-full transition-colors"
      title={isExpanded ? 'Collapse chat window (Cmd/Ctrl+\\)' : 'Expand chat window (Cmd/Ctrl+\\)'}
      aria-label={isExpanded ? 'Collapse chat window' : 'Expand chat window'}
      style={{
        position: 'absolute',
        top: isExpanded ? -1 : -1,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 25,
        width: 80,
        height: 18,
        color: colors.slideToggle,
        boxShadow: colors.cardShadow,
        borderRadius: 10,
        border: `1px solid ${colors.slideToggleSoft}`,
      }}
    >
      {isExpanded ? (
        <CaretDown size={14} weight="bold" />
      ) : (
        <CaretUp size={14} weight="bold" />
      )}
    </button>
  )
}

/** Toggle on the left edge of the chat pane (not the sidebar). */
export function ProjectSidebarToggle() {
  const sidebarOpen = useSessionStore((s) => s.sidebarOpen)
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const colors = useColors()

  return (
    <button
      type="button"
      data-clui-ui
      onClick={() => toggleSidebar()}
      className="clui-pointer flex items-center justify-center"
      title={sidebarOpen ? 'Collapse projects' : 'Expand projects'}
      aria-label={sidebarOpen ? 'Collapse projects' : 'Expand projects'}
      style={{
        position: 'absolute',
        left: sidebarOpen ? -15 : -8,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 25,
        width: 18,
        height: 70,
        borderRadius: 10,
        background: colors.containerBg,
        border: `1px solid ${colors.slideToggleSoft}`,
        boxShadow: colors.cardShadowCollapsed,
        color: colors.slideToggle,
      }}
    >
      {sidebarOpen ? <CaretLeft size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
    </button>
  )
}

function ProjectSidebarItem({
  project,
  isSelected,
  onOpen,
  onRename,
  onDeleteRequest,
}: {
  project: ClaudeProject
  isSelected: boolean
  onOpen: () => void
  onRename: (label: string | null) => void
  onDeleteRequest: () => void
}) {
  const colors = useColors()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const displayName = projectDisplayName(project)

  useEffect(() => {
    if (editing) {
      setDraft(displayName)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing, displayName])

  const commitRename = () => {
    const trimmed = draft.trim()
    const next =
      trimmed && trimmed !== defaultProjectName(project.path) ? trimmed : null
    const current =
      project.displayName?.trim() &&
      project.displayName.trim() !== defaultProjectName(project.path)
        ? project.displayName.trim()
        : null
    if (next !== current) onRename(next)
    setEditing(false)
  }

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDeleteRequest()
  }

  const handleOpenKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      className="rounded-lg mb-0.5 transition-colors flex items-start gap-1 px-2 py-2"
      style={{
        background: isSelected ? colors.tabActive : 'transparent',
        border: isSelected ? `1px solid ${colors.tabActiveBorder}` : '1px solid transparent',
      }}
    >
      <div className="flex items-start gap-1.5 min-w-0 flex-1 text-left">
        <Folder size={13} className="flex-shrink-0 mt-0.5" style={{ color: colors.textTertiary }} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              data-clui-ui
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commitRename}
              className="w-full text-[12px] font-medium rounded px-1 py-0.5 outline-none"
              style={{
                color: colors.textPrimary,
                background: colors.surfaceSecondary,
                border: `1px solid ${colors.tabActiveBorder}`,
              }}
            />
          ) : (
            <div
              data-clui-ui
              role="button"
              tabIndex={0}
              onClick={onOpen}
              onKeyDown={handleOpenKeyDown}
              className="clui-pointer"
            >
              <div
                className="text-[12px] truncate font-medium"
                style={{ color: isSelected ? colors.textPrimary : colors.textSecondary }}
                title={project.path}
                onDoubleClick={startEditing}
              >
                {displayName}
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: colors.textTertiary }}>
                {project.sessionCount === 0
                  ? 'No sessions'
                  : `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`}
                {project.lastTimestamp ? ` · ${formatAgo(project.lastTimestamp)}` : ''}
              </div>
            </div>
          )}
        </div>
      </div>
      {!editing && (
        <div className="flex flex-col flex-shrink-0 gap-0.5 mt-0.5">
          <button
            type="button"
            data-clui-ui
            onClick={startEditing}
            className="clui-pointer p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: colors.textTertiary }}
            title="Rename project"
            aria-label="Rename project"
          >
            <PencilSimple size={11} />
          </button>
          <button
            type="button"
            data-clui-ui
            onClick={handleDelete}
            className="clui-pointer p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
            style={{ color: colors.statusError }}
            title="Remove project from Clui"
            aria-label="Remove project from Clui"
          >
            <Trash size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

function deleteProjectConfirmMessage(project: ClaudeProject): string {
  const sessionNote =
    project.sessionCount === 0
      ? ''
      : ` This removes ${project.sessionCount} Claude session${project.sessionCount === 1 ? '' : 's'}.`
  return `${sessionNote} Your project folder on disk is not deleted.`.trim()
}

export function ProjectSidebarPanel() {
  const sidebarOpen = useSessionStore((s) => s.sidebarOpen)
  const projects = useSessionStore((s) => s.projects)
  const projectsLoading = useSessionStore((s) => s.projectsLoading)
  const selectedProjectPath = useSessionStore((s) => s.selectedProjectPath)
  const openProject = useSessionStore((s) => s.openProject)
  const renameProject = useSessionStore((s) => s.renameProject)
  const deleteProject = useSessionStore((s) => s.deleteProject)
  const createProject = useSessionStore((s) => s.createProject)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const colors = useColors()
  const [pendingDelete, setPendingDelete] = useState<ClaudeProject | null>(null)

  useEffect(() => {
    if (sidebarOpen) void loadProjects()
  }, [sidebarOpen, loadProjects])

  return (
    <>
    <ConfirmDialog
      open={pendingDelete !== null}
      title={pendingDelete ? `Remove "${projectDisplayName(pendingDelete)}" project?` : ''}
      message={pendingDelete ? deleteProjectConfirmMessage(pendingDelete) : ''}
      confirmLabel="Remove"
      destructive
      onConfirm={() => {
        if (pendingDelete) void deleteProject(pendingDelete.path)
        setPendingDelete(null)
      }}
      onCancel={() => setPendingDelete(null)}
    />
    <AnimatePresence initial={false}>
      {sidebarOpen && (
    <motion.div
      data-clui-ui
      initial={{ width: 0 }}
      animate={{ width: SIDEBAR_WIDTH }}
      exit={{ width: 0 }}
      transition={slideTransition}
      className="no-drag flex-shrink-0 overflow-hidden self-stretch"
      style={{ minHeight: 0 }}
    >
      <motion.div
        initial={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
        transition={slideTransitionFast}
        className="flex flex-col h-full overflow-hidden"
        style={{
          width: SIDEBAR_WIDTH,
          borderRight: `1px solid ${colors.popoverBorder}`,
        }}
      >
      <div className="px-2 pt-2 pb-1">
        <div
          className="text-[9px] uppercase tracking-wider px-1"
          style={{ color: colors.textTertiary }}
        >
          Projects
        </div>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {projectsLoading && (
          <div className="text-[11px] px-2 py-3" style={{ color: colors.textTertiary }}>
            Loading…
          </div>
        )}
        {!projectsLoading && projects.length === 0 && (
          <div className="text-[11px] px-2 py-3" style={{ color: colors.textTertiary }}>
            No projects yet
          </div>
        )}
        {projects.map((project) => (
          <ProjectSidebarItem
            key={project.encodedPath}
            project={project}
            isSelected={selectedProjectPath === project.path}
            onOpen={() => void openProject(project.path)}
            onRename={(label) => void renameProject(project.path, label)}
            onDeleteRequest={() => setPendingDelete(project)}
          />
        ))}
      </div>
      <div
        className="flex-shrink-0 px-2 py-2"
        style={{ borderTop: `1px solid ${colors.popoverBorder}` }}
      >
        <button
          type="button"
          onClick={() => void createProject()}
          className="clui-pointer w-full flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors"
          style={{
            color: colors.accent,
            background: colors.surfaceHover,
            border: `1px solid ${colors.popoverBorder}`,
          }}
        >
          <Plus size={12} weight="bold" />
          New project
        </button>
      </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}

export const PROJECT_SIDEBAR_WIDTH = SIDEBAR_WIDTH
