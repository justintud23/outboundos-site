import type { ReactNode } from 'react'
import { MarketingHeader } from './MarketingHeader'
import { MarketingFooter } from './MarketingFooter'

interface MarketingPageProps {
  eyebrow: string
  title: string
  intro?: ReactNode
  children: ReactNode
}

/** Shared shell for the standalone marketing pages (demo, about, contact, legal). */
export function MarketingPage({ eyebrow, title, intro, children }: MarketingPageProps) {
  return (
    <>
      <MarketingHeader />
      <main id="main-content" className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-indigo)]">
            {eyebrow}
          </p>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-[var(--text-primary)] md:text-5xl">
            {title}
          </h1>
          {intro && (
            <p className="mt-6 text-lg leading-relaxed text-[var(--text-secondary)]">{intro}</p>
          )}
          <div className="mt-12">{children}</div>
        </div>
      </main>
      <MarketingFooter />
    </>
  )
}

/** Readable long-form text for the legal and about pages. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5 text-base leading-relaxed text-[var(--text-secondary)] [&_a]:font-medium [&_a]:text-[var(--accent-indigo)] [&_a:hover]:underline [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[var(--text-primary)] [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-[var(--text-primary)] [&_ul]:space-y-2">
      {children}
    </div>
  )
}

export const PRIMARY_BUTTON =
  'group inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] px-7 text-base font-semibold text-[var(--text-inverse)] shadow-[0_10px_24px_rgba(91,84,240,0.32)] transition-all hover:bg-[var(--accent-indigo-hover)] hover:shadow-[0_12px_30px_rgba(91,84,240,0.45)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]'

export const SECONDARY_BUTTON =
  'inline-flex h-12 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-7 text-base font-semibold text-[var(--text-primary)] shadow-[var(--shadow-card)] transition-colors hover:border-[var(--text-muted)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]'
