import type { CliTerminalApp } from '../shared/types'

/** Escape a string for embedding inside an AppleScript double-quoted literal */
export function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Shell-safe single-quote escaping for paths/commands passed to the shell */
export function shellSingleQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

export function buildCliCommand(projectPath: string, sessionId: string | null, claudeBin = 'claude'): string {
  const safeDir = shellSingleQuote(projectPath)
  if (sessionId) {
    return `cd ${safeDir} && ${claudeBin} --resume ${sessionId}`
  }
  return `cd ${safeDir} && ${claudeBin}`
}

export function buildOpenTerminalAppleScript(terminalApp: CliTerminalApp, cmd: string): string {
  const escaped = escapeAppleScript(cmd)
  if (terminalApp === 'iterm') {
    // New tab when iTerm is already open; new window only when none exist
    return `tell application "iTerm"
  activate
  if (count of windows) is 0 then
    set newWindow to (create window with default profile)
    tell current session of newWindow
      write text "${escaped}"
    end tell
  else
    tell current window
      create tab with default profile
      tell current session
        write text "${escaped}"
      end tell
    end tell
  end if
end tell`
  }
  return `tell application "Terminal"
  activate
  do script "${escaped}"
end tell`
}
