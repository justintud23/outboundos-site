import Link from 'next/link'
import { Logo } from '@/components/brand/logo'

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/demo', label: 'Demo' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/blog', label: 'Blog' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/legal/privacy', label: 'Privacy' },
      { href: '/legal/terms', label: 'Terms' },
    ],
  },
]

export function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="space-y-4">
            <Logo size="sm" />
            <p className="max-w-xs text-sm text-[var(--text-secondary)]">
              Outbound that tells you what to do next. The decision engine for B2B sales teams.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {col.title}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-[var(--border-default)] pt-8 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center">
          <p>© 2026 OutboundOS. Built in Chicago.</p>
        </div>
      </div>
    </footer>
  )
}
