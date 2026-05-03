import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const TIERS = [
  { name: 'Starter', price: '$97' },
  { name: 'Growth', price: '$297' },
  { name: 'Scale', price: '$697' },
  { name: 'Managed', price: '$3,500' },
]

export function PricingTeaser() {
  return (
    <section
      id="pricing"
      className="border-t border-white/5 py-24 md:py-32"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Pricing built for outbound teams.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            Four tiers, from solo operators to full-service agencies. Every plan
            includes the Decision Engine, AI drafts, and reply intelligence.
          </p>
        </div>

        <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className="rounded-xl border border-white/5 bg-[var(--bg-surface)]/60 p-6 backdrop-blur"
            >
              <p className="text-sm font-medium text-slate-400">{tier.name}</p>
              <p className="mt-3 text-3xl font-bold tracking-tight text-white">
                {tier.price}
                <span className="ml-1 text-base font-normal text-slate-500">
                  /mo
                </span>
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 flex justify-center">
          <Link
            href="/pricing"
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-7 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
          >
            View All Plans
            <ArrowRight
              size={18}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        </div>
      </div>
    </section>
  )
}
