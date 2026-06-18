const QUEUE = [
  { tier: 'high', kicker: 'Approve draft', who: 'Priya Raman · Helio Labs', accent: 'var(--accent-indigo)' },
  { tier: 'high', kicker: 'Reply received', who: 'Marcus Lin · Aperture', accent: 'var(--accent-magenta)' },
  { tier: 'med', kicker: 'Follow up', who: 'Sam Okoye · Bright&Co', accent: 'var(--status-warning)' },
  { tier: 'med', kicker: 'Enroll sequence', who: '7 warm leads · score ≥ 80', accent: 'var(--accent-cyan)' },
  { tier: 'low', kicker: 'Mark converted', who: 'Ava Chen · Loop', accent: 'var(--status-success)' },
]

export function SolutionSection() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[460px] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7c6cf5]/[0.10] blur-[150px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            One queue.{' '}
            <span className="bg-gradient-to-r from-[#5b54f0] to-[#0fb6a7] bg-clip-text text-transparent">
              Every action.
            </span>{' '}
            Always prioritized.
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-[var(--text-secondary)]">
            OutboundOS continuously scans your entire pipeline — drafts, replies,
            stale leads, hot prospects — and surfaces a single ranked list of what
            to do next. Each action explains why it matters, how urgent it is, and
            lets you execute it in one click without leaving the page.
          </p>
        </div>

        <div className="relative mx-auto mt-16 max-w-4xl">
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[28px] bg-gradient-to-br from-[#5b54f0]/15 via-[#0fb6a7]/10 to-transparent blur-2xl"
          />
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[0_30px_60px_-12px_rgba(80,60,180,0.18)]">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-3 w-3 rounded-full bg-[#ff7a66]" />
                <span className="h-3 w-3 rounded-full bg-[#f6ad3c]" />
                <span className="h-3 w-3 rounded-full bg-[#23c08a]" />
              </div>
              <div className="ml-3 flex-1 truncate rounded-md bg-[var(--bg-base)] px-3 py-1 text-xs text-[var(--text-muted)]">
                app.outboundos.com/action-center
              </div>
            </div>

            {/* Ranked queue */}
            <div className="space-y-2.5 p-5 sm:p-6">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-display text-sm font-semibold text-[var(--text-primary)]">
                  Next best actions
                </span>
                <span className="text-xs font-medium text-[var(--text-muted)]">12 pending</span>
              </div>
              {QUEUE.map((row, i) => (
                <div
                  key={i}
                  className="relative flex items-center gap-3 rounded-[var(--radius-btn)] border border-[var(--border-subtle)] px-4 py-3"
                >
                  <span
                    className="absolute left-0 top-2 bottom-2 rounded-full"
                    style={{
                      width: row.tier === 'high' ? 3 : 2,
                      background: row.accent,
                    }}
                    aria-hidden="true"
                  />
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: row.accent }}
                  >
                    {row.kicker}
                  </span>
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {row.who}
                  </span>
                  <span className="ml-auto flex-shrink-0 text-xs font-medium text-[var(--accent-indigo)]">
                    Execute →
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
