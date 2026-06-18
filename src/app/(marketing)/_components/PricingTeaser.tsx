import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const TIERS = [
  { name: 'Starter', price: '$97', featured: false },
  { name: 'Growth', price: '$297', featured: true },
  { name: 'Scale', price: '$697', featured: false },
  { name: 'Managed', price: '$3,500', featured: false },
]

export function PricingTeaser() {
  return (
    <section id="pricing" className="border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            Pricing built for outbound teams.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-[var(--text-secondary)]">
            Four tiers, from solo operators to full-service agencies. Every plan
            includes the Decision Engine, AI drafts, and reply intelligence.
          </p>
        </div>

        <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-[var(--radius-card)] border bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] ${
                tier.featured
                  ? 'border-[var(--accent-indigo)] ring-1 ring-[var(--accent-indigo-glow)]'
                  : 'border-[var(--border-default)]'
              }`}
            >
              {tier.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-[var(--accent-indigo)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-inverse)]">
                  Popular
                </span>
              )}
              <p className="text-sm font-medium text-[var(--text-secondary)]">{tier.name}</p>
              <p className="mt-3 text-3xl font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
                {tier.price}
                <span className="ml-1 text-base font-normal text-[var(--text-muted)]">/mo</span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <Link
            href="/pricing"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-7 text-base font-semibold text-[var(--text-primary)] shadow-[var(--shadow-card)] transition-colors hover:border-[var(--text-muted)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            View All Plans
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  )
}
