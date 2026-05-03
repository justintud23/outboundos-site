export function SolutionSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24 md:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/10 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            One queue.{' '}
            <span className="bg-gradient-to-br from-indigo-300 to-violet-300 bg-clip-text text-transparent">
              Every action.
            </span>{' '}
            Always prioritized.
          </h2>
          <p className="mt-8 text-lg leading-relaxed text-slate-300">
            OutboundOS continuously scans your entire pipeline — drafts, replies,
            stale leads, hot prospects — and surfaces a single ranked list of what
            to do next. Each action explains why it matters, how urgent it is, and
            lets you execute it in one click without leaving the page.
          </p>
        </div>

        <div className="relative mx-auto mt-16 max-w-5xl">
          <div
            aria-hidden="true"
            className="absolute -inset-4 -z-10 rounded-2xl bg-gradient-to-br from-violet-500/20 via-indigo-500/10 to-transparent blur-2xl"
          />
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--bg-surface)] shadow-2xl shadow-indigo-950/50">
            <div className="flex items-center gap-2 border-b border-white/5 bg-[var(--bg-surface-raised)] px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-3 w-3 rounded-full bg-rose-500/70" />
                <span className="h-3 w-3 rounded-full bg-amber-500/70" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
              </div>
              <div className="ml-3 flex-1 truncate rounded-md bg-[var(--bg-base)]/60 px-3 py-1 text-xs text-slate-500">
                app.outboundos.com/action-center
              </div>
            </div>
            <div
              role="img"
              aria-label="Action Center queue screenshot placeholder"
              className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-[var(--bg-surface)] via-[var(--bg-surface-raised)] to-[var(--bg-surface)]"
            >
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
                Action Center Screenshot
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
