/** Shared easing for panel slide in/out */

export const SLIDE_EASE = [0.32, 0.72, 0, 1] as const

export const slideTransition = {
  duration: 0.48,
  ease: SLIDE_EASE,
} as const

export const slideTransitionFast = {
  duration: 0.42,
  ease: SLIDE_EASE,
} as const

/** Chat body expand/collapse (height + fade) */
export const chatBodyTransition = {
  height: slideTransition,
  opacity: { duration: 0.36, ease: SLIDE_EASE },
} as const
