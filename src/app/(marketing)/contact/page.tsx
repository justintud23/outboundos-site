import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Mail } from 'lucide-react'
import { MarketingPage, PRIMARY_BUTTON } from '../_components/MarketingPage'

export const metadata: Metadata = {
  title: 'Contact | OutboundOS',
  description: 'Get in touch with the OutboundOS team.',
}

const CONTACT_EMAIL = 'justin.tudhope@gmail.com'

export default function ContactPage() {
  return (
    <MarketingPage
      eyebrow="Contact"
      title="Talk to us"
      intro="Questions about OutboundOS, pricing, or whether it fits your team? Send an email and you'll hear back from a real person."
    >
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('OutboundOS question')}`}
        className="flex items-center gap-4 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      >
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)]">
          <Mail size={22} aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm text-[var(--text-muted)]">Email</span>
          <span className="block text-lg font-semibold text-[var(--text-primary)]">{CONTACT_EMAIL}</span>
        </span>
      </a>

      <div className="mt-12 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Want to see it first?</h2>
        <p className="mt-2 text-[var(--text-secondary)]">
          Create an account and try it on your own leads. It takes a couple of minutes.
        </p>
        <div className="mt-5">
          <Link href="/sign-up" className={PRIMARY_BUTTON}>
            Start free trial
            <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </MarketingPage>
  )
}
