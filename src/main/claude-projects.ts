import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { createReadStream } from 'fs'
import { encodeProjectPath } from './session-models'
import { setSessionModel } from './session-models'
import { getAllProjectLabels, getProjectLabel, setProjectLabel } from './project-labels'

export { encodeProjectPath }

export interface ClaudeProjectEntry {
  path: string
  encodedPath: string
  displayName: string | null
  sessionCount: number
  lastTimestamp: string | null
}

export interface ClaudeSessionEntry {
  sessionId: string
  slug: string | null
  firstMessage: string | null
  lastTimestamp: string
  size: number
}

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CLUI_PROJECT_META = 'clui-project-meta.json'

function isValidAbsolutePath(path: string): boolean {
  return path.startsWith('/') && !/[\0\r\n]/.test(path)
}

/** Lossy guess — wrong when folder names contain dashes (e.g. third-party). Prefer resolveProjectPath. */
export function decodeProjectPath(encoded: string): string | null {
  if (!encoded || encoded.includes('.') || encoded === 'clui-models') return null
  if (!encoded.startsWith('-')) return null
  const path = '/' + encoded.slice(1).replace(/-/g, '/')
  if (!isValidAbsolutePath(path)) return null
  return path
}

function writeProjectPathMeta(projectDir: string, projectPath: string): void {
  writeFileSync(
    join(projectDir, CLUI_PROJECT_META),
    JSON.stringify({ path: projectPath }, null, 2),
  )
}

function readProjectPathMeta(projectDir: string): string | null {
  const file = join(projectDir, CLUI_PROJECT_META)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { path?: unknown }
    if (typeof parsed.path === 'string' && isValidAbsolutePath(parsed.path)) {
      return parsed.path
    }
  } catch {}
  return null
}

/** Read cwd fields from session JSONL — Claude stores the real path there. */
function inferProjectPathFromSessions(projectDir: string): string | null {
  const counts = new Map<string, number>()
  let files: string[]
  try {
    files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }

  for (const file of files) {
    if (!SESSION_UUID_RE.test(file.replace(/\.jsonl$/, ''))) continue
    try {
      const raw = readFileSync(join(projectDir, file), 'utf-8')
      const lines = raw.split('\n').slice(0, 80)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed) as { cwd?: unknown }
          if (typeof obj.cwd === 'string' && isValidAbsolutePath(obj.cwd)) {
            counts.set(obj.cwd, (counts.get(obj.cwd) || 0) + 1)
          }
        } catch {}
      }
    } catch {}
  }

  let best: string | null = null
  let bestCount = 0
  for (const [path, count] of counts) {
    if (count > bestCount) {
      best = path
      bestCount = count
    }
  }
  return best
}

/**
 * Map ~/.claude/projects/<encoded-folder> to the real filesystem path.
 * Claude's dash encoding is lossy; we use clui meta, then session cwd, then a best-effort decode.
 */
export function resolveProjectPath(encoded: string, projectDir?: string): string | null {
  const dir = projectDir ?? join(projectsRoot(), encoded)
  if (!existsSync(dir)) return null

  const fromMeta = readProjectPathMeta(dir)
  if (fromMeta) return fromMeta

  const fromSessions = inferProjectPathFromSessions(dir)
  if (fromSessions) {
    try {
      writeProjectPathMeta(dir, fromSessions)
    } catch {}
    return fromSessions
  }

  return decodeProjectPath(encoded)
}

/** Move a custom label from a wrong lossy-decoded path to the resolved path. */
function maybeMigrateProjectLabel(lossyPath: string | null, resolvedPath: string): void {
  if (!lossyPath || lossyPath === resolvedPath) return
  const label = getProjectLabel(lossyPath)
  if (!label || getProjectLabel(resolvedPath)) return
  setProjectLabel(resolvedPath, label)
  setProjectLabel(lossyPath, null)
}

function projectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

async function readSessionMeta(filePath: string, fileSessionId: string): Promise<ClaudeSessionEntry | null> {
  const stat = statSync(filePath)
  if (stat.size < 100) return null

  const meta: {
    validated: boolean
    slug: string | null
    firstMessage: string | null
    lastTimestamp: string | null
  } = {
    validated: false,
    slug: null,
    firstMessage: null,
    lastTimestamp: null,
  }

  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: createReadStream(filePath) })
    rl.on('line', (line: string) => {
      try {
        const obj = JSON.parse(line)
        if (!meta.validated && obj.type && obj.uuid && obj.timestamp) {
          meta.validated = true
        }
        if (obj.slug && !meta.slug) meta.slug = obj.slug
        if (obj.timestamp) meta.lastTimestamp = obj.timestamp
        if (obj.type === 'user' && !meta.firstMessage) {
          const content = obj.message?.content
          if (typeof content === 'string') {
            meta.firstMessage = content.substring(0, 100)
          } else if (Array.isArray(content)) {
            const textPart = content.find((p: { type?: string }) => p.type === 'text')
            meta.firstMessage = textPart?.text?.substring(0, 100) || null
          }
        }
      } catch {}
    })
    rl.on('close', () => resolve())
  })

  if (!meta.validated) return null
  return {
    sessionId: fileSessionId,
    slug: meta.slug,
    firstMessage: meta.firstMessage,
    lastTimestamp: meta.lastTimestamp || stat.mtime.toISOString(),
    size: stat.size,
  }
}

export async function listSessionsForProject(projectPath: string): Promise<ClaudeSessionEntry[]> {
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) return []

  const encodedPath = encodeProjectPath(projectPath)
  const sessionsDir = join(projectsRoot(), encodedPath)
  if (!existsSync(sessionsDir)) return []

  const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))
  const sessions: ClaudeSessionEntry[] = []

  for (const file of files) {
    const fileSessionId = file.replace(/\.jsonl$/, '')
    if (!SESSION_UUID_RE.test(fileSessionId)) continue
    try {
      const entry = await readSessionMeta(join(sessionsDir, file), fileSessionId)
      if (entry) sessions.push(entry)
    } catch {}
  }

  sessions.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
  return sessions.slice(0, 50)
}

function scanProjectSessions(encoded: string): { sessionCount: number; lastTimestamp: string | null } {
  const sessionsDir = join(projectsRoot(), encoded)
  if (!existsSync(sessionsDir)) return { sessionCount: 0, lastTimestamp: null }

  let sessionCount = 0
  let lastMs = 0
  for (const file of readdirSync(sessionsDir)) {
    if (!file.endsWith('.jsonl')) continue
    const id = file.replace(/\.jsonl$/, '')
    if (!SESSION_UUID_RE.test(id)) continue
    sessionCount++
    try {
      const mtime = statSync(join(sessionsDir, file)).mtime.getTime()
      if (mtime > lastMs) lastMs = mtime
    } catch {}
  }
  return {
    sessionCount,
    lastTimestamp: lastMs > 0 ? new Date(lastMs).toISOString() : null,
  }
}

function defaultProjectLabel(projectPath: string): string {
  const parts = projectPath.replace(/\/$/, '').split('/').filter(Boolean)
  return parts[parts.length - 1] || projectPath
}

/** Register a project folder under ~/.claude/projects/ (creates encoded dir if missing). */
export function ensureProjectDirectory(projectPath: string): boolean {
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) return false
  try {
    const encoded = encodeProjectPath(projectPath)
    const projectDir = join(projectsRoot(), encoded)
    mkdirSync(projectDir, { recursive: true })
    writeProjectPathMeta(projectDir, projectPath)
    if (!getProjectLabel(projectPath)) {
      setProjectLabel(projectPath, defaultProjectLabel(projectPath))
    }
    return true
  } catch {
    return false
  }
}

export function listProjects(): ClaudeProjectEntry[] {
  const root = projectsRoot()
  if (!existsSync(root)) return []

  const projects: ClaudeProjectEntry[] = []
  const labels = getAllProjectLabels()

  for (const encoded of readdirSync(root)) {
    const fullPath = join(root, encoded)
    try {
      if (!statSync(fullPath).isDirectory()) continue
    } catch {
      continue
    }

    const projectPath = resolveProjectPath(encoded, fullPath)
    if (!projectPath) continue

    maybeMigrateProjectLabel(decodeProjectPath(encoded), projectPath)

    const { sessionCount, lastTimestamp } = scanProjectSessions(encoded)
    let dirMtime: string | null = null
    try {
      dirMtime = statSync(fullPath).mtime.toISOString()
    } catch {}

    projects.push({
      path: projectPath,
      encodedPath: encoded,
      displayName: labels[projectPath] ?? null,
      sessionCount,
      lastTimestamp: lastTimestamp || dirMtime,
    })
  }

  projects.sort((a, b) => {
    const ta = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0
    const tb = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0
    return tb - ta
  })

  return projects
}

export function deleteSession(projectPath: string, sessionId: string): boolean {
  if (!SESSION_UUID_RE.test(sessionId)) return false
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) return false

  const encodedPath = encodeProjectPath(projectPath)
  const filePath = join(projectsRoot(), encodedPath, `${sessionId}.jsonl`)
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    setSessionModel(projectPath, sessionId, null)
    return true
  } catch {
    return false
  }
}

/** Remove Claude session history for a project (~/.claude/projects/<encoded>). Does not delete source files on disk. */
export function deleteProject(projectPath: string): boolean {
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) return false

  const projectDir = join(projectsRoot(), encodeProjectPath(projectPath))
  try {
    if (existsSync(projectDir)) {
      rmSync(projectDir, { recursive: true, force: true })
    }
    setProjectLabel(projectPath, null)
    return true
  } catch {
    return false
  }
}
