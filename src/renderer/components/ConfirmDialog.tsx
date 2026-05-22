import React, { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useColors, useThemeStore } from '../theme'
import { usePopoverLayer } from './PopoverLayer'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet with vibrancy-style glass (replaces window.confirm).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const colors = useColors()
  const isDark = useThemeStore((s) => s.isDark)
  const layer = usePopoverLayer()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  const panelBg = isDark ? 'rgba(36, 36, 34, 0.72)' : 'rgba(249, 248, 245, 0.78)'
  const overlayBg = isDark ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.08)'

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          data-clui-ui
          role="dialog"
          aria-modal="true"
          aria-labelledby="clui-confirm-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="flex items-center justify-center"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            pointerEvents: 'auto',
            background: overlayBg,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
            className="rounded-2xl no-drag"
            style={{
              width: 300,
              maxWidth: 'calc(100vw - 32px)',
              padding: '16px 18px',
              background: panelBg,
              backdropFilter: 'blur(40px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(40px) saturate(1.6)',
              border: `1px solid ${colors.popoverBorder}`,
              boxShadow: colors.popoverShadow,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              id="clui-confirm-title"
              className="text-[13px] font-semibold leading-snug"
              style={{ color: colors.textPrimary }}
            >
              {title}
            </div>
            <p
              className="text-[11px] leading-relaxed mt-2 mb-4"
              style={{ color: colors.textSecondary }}
            >
              {message}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-clui-ui
                onClick={onCancel}
                className="clui-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{
                  color: colors.textSecondary,
                  background: colors.surfaceHover,
                  border: `1px solid ${colors.containerBorder}`,
                }}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                data-clui-ui
                onClick={onConfirm}
                className="clui-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors"
                style={{
                  color: destructive ? colors.textOnAccent : colors.textPrimary,
                  background: destructive ? colors.statusError : colors.accent,
                  border: `1px solid ${destructive ? colors.statusError : colors.accent}`,
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  if (layer) return createPortal(content, layer)
  return createPortal(content, document.body)
}
