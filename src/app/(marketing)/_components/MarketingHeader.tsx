'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Logo } from '@/components/brand/logo'

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
]

export function MarketingHeader() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          aria-label="OutboundOS home"
          className="rounded-lg outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <Logo size="sm" />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            Sign In
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-9 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] px-4 text-sm font-semibold text-[var(--text-inverse)] shadow-[0_6px_16px_rgba(91,84,240,0.30)] transition-all hover:bg-[var(--accent-indigo-hover)] hover:shadow-[0_8px_22px_rgba(91,84,240,0.42)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-raised)] md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div
          id="mobile-nav"
          className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)]/95 backdrop-blur-md md:hidden"
        >
          <nav className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-4" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-btn)] px-3 py-3 text-base font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)]"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
              <Link
                href="/sign-in"
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-btn)] px-3 py-3 text-base font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)]"
              >
                Sign In
              </Link>
              <Link
                href="/demo"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] px-4 text-base font-semibold text-[var(--text-inverse)] shadow-[0_6px_16px_rgba(91,84,240,0.30)]"
              >
                Get Started
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
