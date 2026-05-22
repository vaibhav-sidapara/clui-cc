import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

const LABELS_FILE = join(homedir(), '.claude', 'clui-project-labels.json')

function readAll(): Record<string, string> {
  try {
    if (!existsSync(LABELS_FILE)) return {}
    const parsed = JSON.parse(readFileSync(LABELS_FILE, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && key.startsWith('/') && typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) out[key] = trimmed
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, string>): void {
  mkdirSync(dirname(LABELS_FILE), { recursive: true })
  writeFileSync(LABELS_FILE, JSON.stringify(data, null, 2))
}

export function getProjectLabel(projectPath: string): string | null {
  if (!projectPath.startsWith('/')) return null
  return readAll()[projectPath] ?? null
}

export function getAllProjectLabels(): Record<string, string> {
  return readAll()
}

export function setProjectLabel(projectPath: string, label: string | null): boolean {
  if (/[\0\r\n]/.test(projectPath) || !projectPath.startsWith('/')) return false
  const data = readAll()
  const trimmed = label?.trim() ?? ''
  if (trimmed) {
    data[projectPath] = trimmed
  } else {
    delete data[projectPath]
  }
  writeAll(data)
  return true
}
