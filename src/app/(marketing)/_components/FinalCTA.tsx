import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-1/2 h-[460px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7c6cf5]/[0.14] blur-[150px]" />
        <div className="absolute left-1/3 top-1/3 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-[#ff7a66]/[0.10] blur-[130px]" />
      </div>

      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="text-4xl font-bold tracking-tight text-[var(--text-primary)] md:text-5xl lg:text-6xl">
          Stop guessing.{' '}
          <span className="bg-gradient-to-r from-[#5b54f0] to-[#ff7a66] bg-clip-text text-transparent">
            Start closing.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--text-secondary)]">
          Book a 30-minute demo. We&apos;ll show you how the Action Center works
          on your specific use case.
        </p>

        <div className="mt-10 flex justify-center">
          <Link
            href="/demo"
            className="group inline-flex h-14 items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] px-8 text-base font-semibold text-[var(--text-inverse)] shadow-[0_14px_34px_rgba(91,84,240,0.34)] transition-all hover:bg-[var(--accent-indigo-hover)] hover:shadow-[0_16px_40px_rgba(91,84,240,0.48)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            Book a Demo
            <ArrowRight size={20} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <p className="mt-5 text-sm text-[var(--text-muted)]">
          No hard sells. If it&apos;s not a fit, we&apos;ll tell you.
        </p>
      </div>
    </section>
  )
}
