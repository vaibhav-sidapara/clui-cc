import type { AssistantMessagePayload, ResultEvent } from '../../shared/types'

/** Shown when the CLI reports failure without a message (common for rate/session limits). */
export const REQUEST_FAILED_FALLBACK =
  'Request failed. If you hit a session or usage limit, wait until the reset time and try again.'

export function assistantMessagePayload(event: unknown): AssistantMessagePayload | null {
  if (!event || typeof event !== 'object') return null
  const e = event as Record<string, unknown>
  const message = e.message as Record<string, unknown> | undefined
  if (message && Array.isArray(message.content)) {
    return message as AssistantMessagePayload
  }
  if (Array.isArray(e.content)) {
    return {
      model: typeof message?.model === 'string' ? message.model : 'unknown',
      id: typeof message?.id === 'string' ? message.id : '',
      role: 'assistant',
      content: e.content as AssistantMessagePayload['content'],
      stop_reason: null,
      usage: {},
    }
  }
  return null
}

export function textFromAssistantPayload(payload: AssistantMessagePayload | null): string {
  if (!payload?.content) return ''
  return payload.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('')
}

export function isRateLimitAssistantEvent(event: unknown): boolean {
  if (!event || typeof event !== 'object') return false
  const e = event as Record<string, unknown>
  return e.error === 'rate_limit' || e.isApiErrorMessage === true
}

export function isLimitMessage(text: string): boolean {
  return /session limit|rate limit|usage limit/i.test(text)
}

export function extractResultErrorMessage(event: ResultEvent): string {
  const raw = event.result
  if (typeof raw === 'string' && raw.trim()) return raw.trim()

  const any = event as Record<string, unknown>
  if (typeof any.error === 'string' && any.error.trim()) return any.error.trim()
  if (any.error && typeof any.error === 'object') {
    const errObj = any.error as Record<string, unknown>
    if (typeof errObj.message === 'string' && errObj.message.trim()) return errObj.message.trim()
  }
  if (Array.isArray(any.errors)) {
    for (const item of any.errors) {
      if (typeof item === 'string' && item.trim()) return item.trim()
      if (item && typeof item === 'object') {
        const msg = (item as Record<string, unknown>).message
        if (typeof msg === 'string' && msg.trim()) return msg.trim()
      }
    }
  }

  return ''
}

/** Best-effort parse of truncated stdout ring-buffer lines. */
export function rateLimitMessageFromStdoutLines(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.startsWith('[parse-error]')) continue
    try {
      const raw = JSON.parse(line)
      if (raw.type === 'assistant') {
        const text = textFromAssistantPayload(assistantMessagePayload(raw))
        if (text && (isRateLimitAssistantEvent(raw) || isLimitMessage(text))) return text
      }
    } catch {
      const match = line.match(/You've hit your session limit[^"\\]*/i)
      if (match) return match[0]
    }
  }
  return null
}

export function resolveErrorMessage(
  primary: string,
  hints: { lastRateLimitMessage?: string; stdoutTail?: string[] }
): string {
  if (primary && primary !== 'Unknown error') return primary
  if (hints.lastRateLimitMessage) return hints.lastRateLimitMessage
  const fromStdout = hints.stdoutTail ? rateLimitMessageFromStdoutLines(hints.stdoutTail) : null
  if (fromStdout) return fromStdout
  return primary === 'Unknown error' ? REQUEST_FAILED_FALLBACK : primary || REQUEST_FAILED_FALLBACK
}
