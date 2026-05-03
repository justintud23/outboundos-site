const STATS = [
  {
    value: '73%',
    label: "of 'interested' replies aren't followed up within 24 hours",
  },
  {
    value: '47%',
    label: 'of pipeline goes stale due to bad prioritization',
  },
  {
    value: '4.2 hrs',
    label: 'average daily time spent on outbound admin',
  },
]

export function ProblemSection() {
  return (
    <section className="border-t border-white/5 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Cold email tools give you data.{' '}
            <span className="text-slate-400">
              They don&apos;t tell you what to do with it.
            </span>
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-slate-300">
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
              className="rounded-xl border border-white/5 bg-[var(--bg-surface)]/60 p-8 backdrop-blur transition-colors hover:border-white/10"
            >
              <p className="bg-gradient-to-br from-indigo-300 to-violet-300 bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-6xl">
                {stat.value}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
