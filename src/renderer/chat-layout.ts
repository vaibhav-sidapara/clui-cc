/** Fixed chat body dimensions — keeps card height stable across projects/tabs */

export function chatLayoutMetrics(expandedUI: boolean) {
  const conversationHeight = expandedUI ? 460 : 336
  const statusBarHeight = 36
  const bodyHeight = conversationHeight + statusBarHeight
  return { conversationHeight, statusBarHeight, bodyHeight }
}
