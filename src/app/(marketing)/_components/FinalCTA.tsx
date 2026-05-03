import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24 md:py-32">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute left-1/2 top-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/15 blur-[140px]" />
      </div>

      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-6xl">
          Stop guessing.{' '}
          <span className="bg-gradient-to-br from-indigo-300 to-violet-300 bg-clip-text text-transparent">
            Start closing.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
          Book a 30-minute demo. We&apos;ll show you how the Action Center works
          on your specific use case.
        </p>

        <div className="mt-10 flex justify-center">
          <Link
            href="/demo"
            className="group inline-flex h-14 items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 px-8 text-base font-semibold text-white shadow-xl shadow-indigo-500/30 transition-all hover:shadow-indigo-500/50 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
          >
            Book a Demo
            <ArrowRight
              size={20}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>

        <p className="mt-5 text-sm text-slate-500">
          No hard sells. If it&apos;s not a fit, we&apos;ll tell you.
        </p>
      </div>
    </section>
  )
}
