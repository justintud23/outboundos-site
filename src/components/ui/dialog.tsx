'use client'

import { useEffect, useId, useRef } from 'react'
import { clsx } from 'clsx'

interface DialogProps {
  /** Heading shown in the header; also wired to aria-labelledby. */
  title: string
  /** Called on Escape, backdrop click, or the close button (ignored while busy). */
  onClose: () => void
  /** Panel max width. md = max-w-md, lg = max-w-lg. */
  size?: 'md' | 'lg'
  /** While true, the dialog won't close via Escape/backdrop/close button (e.g. a submit in flight). */
  busy?: boolean
  /** Footer action bar; rendered in a bordered region below the scrollable body. */
  footer?: React.ReactNode
  /** Scrollable body content. */
  children: React.ReactNode
}

// Elements that can receive focus, for the focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A right-side drawer dialog. Render it conditionally (mount = open) — the parent
 * controls visibility, and unmounting restores focus. Provides the chrome
 * (backdrop, panel, header with title + close, scrollable body, footer) plus the
 * accessibility the ad-hoc versions lacked: role="dialog" + aria-modal, focus
 * moved into the panel on open, a Tab focus trap, Escape-to-close, and focus
 * restoration to the previously-focused element on close.
 */
export function Dialog({ title, onClose, size = 'md', busy = false, footer, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Move focus into the dialog on open; restore it on close (unmount).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      previouslyFocused?.focus?.()
    }
  }, [])

  // Escape-to-close, at the document level so it fires regardless of focus.
  // Re-subscribes when busy/onClose change so it always sees current values.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  // Focus trap: keep Tab / Shift+Tab cycling within the panel.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    // Disabled and tabindex="-1" are excluded by the selector. We don't filter by
    // layout visibility: these dialogs add/remove focusables via conditional
    // rendering (not display:none), so everything matched is genuinely focusable.
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusable.length === 0) {
      e.preventDefault()
      panel.focus()
      return
    }
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    const active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === panel) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={clsx(
          'fixed right-0 top-0 h-full w-full bg-[var(--bg-base)] border-l border-[var(--border-default)]',
          'z-50 flex flex-col shadow-2xl focus:outline-none',
          size === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 id={titleId} className="text-[var(--text-primary)] font-semibold text-sm">
            {title}
          </h2>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            aria-label="Close"
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-[var(--transition-base)] text-lg leading-none disabled:opacity-50"
          >
            {'✕'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-[var(--border-default)]">{footer}</div>
        )}
      </div>
    </>
  )
}
