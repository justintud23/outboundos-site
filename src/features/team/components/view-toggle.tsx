'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ViewMode } from '../view'

const STORAGE_KEY = 'outboundos:view'

const OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: 'mine', label: 'Mine' },
  { mode: 'team', label: 'Team' },
]

function readStoredView(): ViewMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'mine' || value === 'team' ? value : null
  } catch {
    return null
  }
}

function writeStoredView(view: ViewMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, view)
  } catch {
    // localStorage may be unavailable (private mode, blocked) — the toggle
    // still works for this navigation, it just won't be remembered.
  }
}

function buildHref(pathname: string, searchParams: URLSearchParams, next: ViewMode): string {
  const params = new URLSearchParams(searchParams.toString())
  params.set('view', next)
  return `${pathname}?${params.toString()}`
}

interface ViewToggleProps {
  view: ViewMode
}

/** Mine / Team segmented control. Writes ?view= and remembers the choice in localStorage. */
export function ViewToggle({ view }: ViewToggleProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // On mount, if the URL doesn't say which view to show, fall back to the
  // last remembered choice rather than the server-computed default.
  useEffect(() => {
    if (searchParams.get('view')) return
    const stored = readStoredView()
    if (stored && stored !== view) {
      router.replace(buildHref(pathname, searchParams, stored))
    }
  }, [pathname, router, searchParams, view])

  function handleSelect(next: ViewMode) {
    writeStoredView(next)
    router.push(buildHref(pathname, searchParams, next))
  }

  return (
    <div className="flex gap-0.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-0.5">
      {OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          type="button"
          aria-pressed={view === mode}
          onClick={() => handleSelect(mode)}
          className={[
            'px-3 py-1.5 rounded-[calc(var(--radius-btn)-2px)] text-xs font-medium cursor-pointer',
            'transition-all duration-[var(--transition-base)]',
            view === mode
              ? 'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
