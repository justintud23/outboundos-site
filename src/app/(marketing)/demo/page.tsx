import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, PlayCircle } from 'lucide-react'
import { MarketingPage, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../_components/MarketingPage'

export const metadata: Metadata = {
  title: 'Demo | OutboundOS',
  description: 'See how OutboundOS turns your pipeline into a prioritized list of next actions.',
}

// Paste an embeddable video URL here (e.g. a Loom or YouTube "embed" link) and
// the placeholder below becomes the player. Nothing else needs to change.
const DEMO_VIDEO_URL: string | null = null

const STEPS = [
  {
    title: 'Import your leads',
    body: 'Upload a CSV or pull a Salesforce list view. Every lead gets an AI score from 0 to 100 with the reasoning behind it.',
  },
  {
    title: 'Approve AI-drafted outreach',
    body: 'Sequences draft each email for you. Approve a sample, and the rest sends automatically from your own Microsoft 365 mailboxes.',
  },
  {
    title: 'Work the Action Center',
    body: 'Replies, follow-ups and hot leads land in one ranked queue, each with the reason it matters and a one-click action.',
  },
]

export default function DemoPage() {
  return (
    <MarketingPage
      eyebrow="Demo"
      title="See OutboundOS in two minutes"
      intro="A quick tour of how OutboundOS decides what your team should do next, and lets them do it in one click."
    >
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
        {DEMO_VIDEO_URL ? (
          <iframe
            src={DEMO_VIDEO_URL}
            title="OutboundOS demo video"
            className="aspect-video w-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#5b54f0]/10 via-[#7c6cf5]/5 to-[#ff7a66]/10 px-6 text-center">
            <PlayCircle size={56} className="text-[var(--accent-indigo)]" aria-hidden="true" />
            <p className="text-lg font-semibold text-[var(--text-primary)]">Demo video coming soon</p>
            <p className="max-w-sm text-sm text-[var(--text-secondary)]">
              In the meantime, the fastest way to see it is to try it yourself.
            </p>
          </div>
        )}
      </div>

      <ol className="mt-12 space-y-4">
        {STEPS.map((step, idx) => (
          <li
            key={step.title}
            className="flex gap-5 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-card)]"
          >
            <span className="font-mono text-2xl font-bold tabular-nums text-[var(--accent-indigo)]">
              {String(idx + 1).padStart(2, '0')}
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{step.title}</h2>
              <p className="mt-1 text-[var(--text-secondary)]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12 flex flex-col gap-3 sm:flex-row">
        <Link href="/sign-up" className={PRIMARY_BUTTON}>
          Try it yourself
          <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link href="/contact" className={SECONDARY_BUTTON}>
          Ask a question
        </Link>
      </div>
    </MarketingPage>
  )
}
