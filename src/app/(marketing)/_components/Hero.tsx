import Link from 'next/link'
import { ArrowRight, FileCheck, Reply, GitBranch } from 'lucide-react'

const PROOF = [
  { value: '3.4×', label: 'more replies per rep' },
  { value: '12h', label: 'saved every week' },
  { value: '98%', label: 'inbox delivery' },
]

// A faithful little Action Center preview — the product's wedge, shown live.
const PREVIEW = [
  {
    icon: FileCheck,
    kicker: 'Approve draft',
    name: 'Dana Whitfield · Northwind',
    reason: 'Opened twice, no reply — nudge ready',
    cta: 'Review',
    accent: 'var(--accent-indigo)',
    text: 'text-[var(--accent-indigo-hover)]',
    solid: true,
  },
  {
    icon: Reply,
    kicker: 'Reply received',
    name: 'Marcus Lin · Aperture',
    reason: '“Can you send pricing?” — positive intent',
    cta: 'Open',
    accent: 'var(--accent-magenta)',
    text: 'text-[var(--accent-magenta)]',
    solid: false,
  },
  {
    icon: GitBranch,
    kicker: 'Enroll sequence',
    name: '7 warm leads',
    reason: 'Score ≥ 80 · ready for follow-up cadence',
    cta: 'Enroll',
    accent: 'var(--accent-cyan)',
    text: 'text-[var(--accent-cyan)]',
    solid: false,
  },
]

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Prism aurora accents — localized lift over the global canvas wash */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-0 h-[560px] w-[680px] rounded-full bg-[#7c6cf5]/[0.18] blur-[130px]" />
        <div className="absolute -top-24 right-0 h-[440px] w-[440px] rounded-full bg-[#ff7a66]/[0.12] blur-[120px]" />
        <div className="absolute top-72 right-1/4 h-[380px] w-[380px] rounded-full bg-[#0fb6a7]/[0.10] blur-[120px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left — message */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-indigo)] shadow-[var(--shadow-card)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--status-success)] opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--status-success)]" />
              </span>
              Now with AI-prioritized pipeline
            </span>

            <h1 className="mt-6 text-5xl font-bold leading-[1.02] tracking-tight text-[var(--text-primary)] md:text-6xl">
              Every outbound move,{' '}
              <span className="bg-gradient-to-r from-[#5b54f0] to-[#ff7a66] bg-clip-text text-transparent">
                ranked and ready.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-secondary)]">
              OutboundOS reads your whole pipeline and tells your team the single
              best action to take next — with the reasoning, executable in one click.
              No more dashboards, no more guesswork.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] px-7 text-base font-semibold text-[var(--text-inverse)] shadow-[0_10px_24px_rgba(91,84,240,0.32)] transition-all hover:bg-[var(--accent-indigo-hover)] hover:shadow-[0_12px_30px_rgba(91,84,240,0.45)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                Start free trial
                <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex h-12 items-center justify-center rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-7 text-base font-semibold text-[var(--text-primary)] shadow-[var(--shadow-card)] transition-colors hover:border-[var(--text-muted)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              >
                Watch 2-min demo
              </Link>
            </div>

            <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
              {PROOF.map((p) => (
                <div key={p.label}>
                  <dt className="sr-only">{p.label}</dt>
                  <dd>
                    <span className="block text-2xl font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
                      {p.value}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--text-muted)]">{p.label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right — floating Action Center card */}
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute -inset-6 -z-10 rounded-[28px] bg-gradient-to-br from-[#7c6cf5]/20 via-[#ff7a66]/10 to-transparent blur-2xl"
            />
            <div className="rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-[0_30px_60px_-12px_rgba(80,60,180,0.22)]">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-display text-[15px] font-semibold text-[var(--text-primary)]">
                  Action Center
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--status-success)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)]" />
                  Live
                </span>
              </div>

              <div className="space-y-2.5">
                {PREVIEW.map((row) => {
                  const Icon = row.icon
                  return (
                    <div
                      key={row.kicker}
                      className="relative flex items-center gap-3 rounded-[var(--radius-btn)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                    >
                      <span
                        className="absolute left-0 top-2 bottom-2 w-1 rounded-full"
                        style={{ background: row.accent }}
                        aria-hidden="true"
                      />
                      <div
                        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                        style={{ background: `color-mix(in srgb, ${row.accent} 12%, transparent)` }}
                        aria-hidden="true"
                      >
                        <Icon size={16} className={row.text} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[10px] font-semibold uppercase tracking-wider ${row.text}`}>
                          {row.kicker}
                        </p>
                        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                          {row.name}
                        </p>
                        <p className="truncate text-xs text-[var(--text-muted)]">{row.reason}</p>
                      </div>
                      <span
                        className={`flex-shrink-0 rounded-[8px] px-3 py-1.5 text-xs font-semibold ${
                          row.solid ? 'text-[var(--text-inverse)]' : row.text
                        }`}
                        style={
                          row.solid
                            ? { background: row.accent }
                            : { background: `color-mix(in srgb, ${row.accent} 12%, transparent)` }
                        }
                      >
                        {row.cta}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <p className="mt-12 text-center text-sm text-[var(--text-muted)] lg:text-left">
          Built for B2B agencies and founder-led teams running cold outbound.
        </p>
      </div>
    </section>
  )
}
