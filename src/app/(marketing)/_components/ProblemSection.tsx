const STATS = [
  {
    value: '73%',
    label: "of 'interested' replies aren't followed up within 24 hours",
    grad: 'from-[#5b54f0] to-[#7c6cf5]',
  },
  {
    value: '47%',
    label: 'of pipeline goes stale due to bad prioritization',
    grad: 'from-[#ff7a66] to-[#f6ad3c]',
  },
  {
    value: '4.2 hrs',
    label: 'average daily time spent on outbound admin',
    grad: 'from-[#0fb6a7] to-[#5b54f0]',
  },
]

export function ProblemSection() {
  return (
    <section className="border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            Cold email tools give you data.{' '}
            <span className="text-[var(--text-muted)]">
              They don&apos;t tell you what to do with it.
            </span>
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-[var(--text-secondary)]">
            You open Smartlead. You see 47 replies, 12 hot leads, 230 stale prospects,
            and 89 drafts waiting for approval. Now what? Most teams burn 30+ minutes
            every morning just deciding where to start. By the time they reach the
            high-priority lead, they&apos;ve lost the window.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div
              key={stat.value}
              className="rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
            >
              <p
                className={`bg-gradient-to-br ${stat.grad} bg-clip-text text-5xl font-bold tabular-nums tracking-tight text-transparent md:text-6xl`}
              >
                {stat.value}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
