import { accessSync, constants, existsSync, readdirSync, realpathSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { getCliEnv } from './cli-env'

let cachedBinary: string | null = null

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Confirm candidate exists; return the path we should pass to spawn (prefer launcher symlink). */
function tryResolve(candidate: string): string | null {
  const trimmed = candidate.trim()
  if (!trimmed || trimmed === 'claude') return null
  if (!existsSync(trimmed)) return null

  try {
    const resolved = realpathSync(trimmed)
    if (!isExecutable(resolved)) return null
  } catch {
    if (!isExecutable(trimmed)) return null
  }

  return trimmed
}

function discoverViaShell(): string | null {
  const commands = [
    '/bin/zsh -ilc "whence -p claude 2>/dev/null | head -1"',
    '/bin/zsh -lc "command -v claude 2>/dev/null | head -1"',
    '/bin/bash -lc "command -v claude 2>/dev/null | head -1"',
  ]

  for (const cmd of commands) {
    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        env: getCliEnv(),
        timeout: 5000,
      }).trim()
      const found = tryResolve(result)
      if (found) return found
    } catch {}
  }
  return null
}

function discoverViaNvm(): string | null {
  const nvmRoot = join(homedir(), '.nvm/versions/node')
  try {
    const versions = readdirSync(nvmRoot).filter((v) => !v.startsWith('.')).sort().reverse()
    for (const version of versions) {
      const found = tryResolve(join(nvmRoot, version, 'bin/claude'))
      if (found) return found
    }
  } catch {}
  return null
}

function discoverClaudeBinary(): string {
  const fromEnv = process.env.CLUI_CLAUDE_BIN || process.env.CLAUDE_BIN
  if (fromEnv) {
    const found = tryResolve(fromEnv)
    if (found) return found
  }

  const home = homedir()
  const candidates = [
    join(home, '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(home, '.npm-global/bin/claude'),
  ]

  for (const candidate of candidates) {
    const found = tryResolve(candidate)
    if (found) return found
  }

  const fromShell = discoverViaShell()
  if (fromShell) return fromShell

  const fromNvm = discoverViaNvm()
  if (fromNvm) return fromNvm

  throw new Error(
    'Claude Code CLI not found. Install it from https://docs.anthropic.com/en/docs/claude-code ' +
      'or set CLUI_CLAUDE_BIN to the full path of the claude executable.',
  )
}

export function invalidateClaudeBinaryCache(): void {
  cachedBinary = null
}

/** Locate the claude executable (cached; re-validated on each call). */
export function resolveClaudeBinary(): string {
  if (cachedBinary) {
    const stillValid = tryResolve(cachedBinary)
    if (stillValid) return stillValid
    cachedBinary = null
  }

  cachedBinary = discoverClaudeBinary()
  return cachedBinary
}

/**
 * Working directory for claude spawn. Node emits misleading ENOENT on the binary
 * when cwd does not exist — fall back to home if the project folder is missing.
 */
export function resolveSpawnCwd(projectPath?: string): string {
  const home = homedir()
  const raw = !projectPath || projectPath === '~' ? home : projectPath
  try {
    if (statSync(raw).isDirectory()) return raw
  } catch {}
  return home
}
