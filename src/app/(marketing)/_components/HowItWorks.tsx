const STEPS = [
  {
    number: '01',
    title: 'Import your leads',
    description: 'CSV upload, AI scoring 0–100 with reasoning.',
    grad: 'from-[#5b54f0] to-[#7c6cf5]',
  },
  {
    number: '02',
    title: 'AI drafts your outreach',
    description: 'You approve, edit, or rewrite — never start from blank.',
    grad: 'from-[#7c6cf5] to-[#ff7a66]',
  },
  {
    number: '03',
    title: 'Action Center runs your day',
    description: 'Open the queue, work top-down, hit your numbers.',
    grad: 'from-[#ff7a66] to-[#0fb6a7]',
  },
]

export function HowItWorks() {
  return (
    <section className="border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-indigo)]">
            How it works
          </p>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            Three steps to a focused outbound day.
          </h2>
        </div>

        <ol className="mt-16 grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, idx) => (
            <li key={step.number} className="relative">
              <div className="h-full rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-7 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
                <span
                  className={`bg-gradient-to-br ${step.grad} bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent`}
                >
                  {step.number}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-[var(--text-primary)]">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {step.description}
                </p>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className="absolute right-0 top-1/2 hidden h-px w-6 -translate-y-1/2 translate-x-full bg-gradient-to-r from-[var(--border-default)] to-transparent md:block"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
