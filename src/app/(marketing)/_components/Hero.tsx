import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Ambient gradient accents */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -top-40 left-1/2 h-[640px] w-[1000px] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-40 right-0 h-[420px] w-[420px] rounded-full bg-violet-600/15 blur-[100px]" />
      </div>

      <div className="mx-auto max-w-7xl px-6 pt-20 pb-24 md:pt-28 md:pb-32">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
            Outbound, reimagined
          </p>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-white md:text-6xl lg:text-7xl">
            Your sales team shouldn&apos;t be guessing what to do next.
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-slate-300 md:text-xl">
            OutboundOS turns your pipeline into a prioritized action queue. AI tells
            you the next best move, explains why, and lets you execute it inline —
            no more dashboards, no more guesswork.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-7 text-base font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-indigo-500/50 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              Book a Demo
              <ArrowRight
                size={18}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex h-12 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-7 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              View Dashboard
            </Link>
          </div>

          <p className="mt-6 text-sm text-slate-500">
            Built for B2B agencies and founder-led teams running cold outbound.
          </p>
        </div>

        {/* Hero visual: browser mockup placeholder */}
        <div className="relative mx-auto mt-20 max-w-5xl">
          <div
            aria-hidden="true"
            className="absolute -inset-4 -z-10 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-violet-500/10 to-transparent blur-2xl"
          />
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[var(--bg-surface)] shadow-2xl shadow-indigo-950/50">
            {/* Browser chrome */}
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
            {/* Screenshot placeholder */}
            <div
              role="img"
              aria-label="Action Center screenshot placeholder"
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
