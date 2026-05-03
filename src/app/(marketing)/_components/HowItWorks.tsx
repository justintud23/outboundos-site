const STEPS = [
  {
    number: '01',
    title: 'Import your leads',
    description: 'CSV upload, AI scoring 0–100 with reasoning.',
  },
  {
    number: '02',
    title: 'AI drafts your outreach',
    description:
      'You approve, edit, or rewrite — never start from blank.',
  },
  {
    number: '03',
    title: 'Action Center runs your day',
    description: 'Open the queue, work top-down, hit your numbers.',
  },
]

export function HowItWorks() {
  return (
    <section className="border-t border-white/5 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
            How it works
          </p>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Three steps to a focused outbound day.
          </h2>
        </div>

        <ol className="mt-16 grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, idx) => (
            <li key={step.number} className="relative">
              <div className="rounded-xl border border-white/5 bg-[var(--bg-surface)]/60 p-7 backdrop-blur">
                <span className="bg-gradient-to-br from-indigo-300 to-violet-300 bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent">
                  {step.number}
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {step.description}
                </p>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  aria-hidden="true"
                  className="absolute right-0 top-1/2 hidden h-px w-6 -translate-y-1/2 translate-x-full bg-gradient-to-r from-white/10 to-transparent md:block"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
