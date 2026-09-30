import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { MarketingPage, PRIMARY_BUTTON, Prose } from '../_components/MarketingPage'

export const metadata: Metadata = {
  title: 'About | OutboundOS',
  description: 'Why OutboundOS exists and who it is built for.',
}

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title="Outbound that tells you what to do next"
      intro="Most sales tools show you dashboards. OutboundOS tells your team the single best action to take next, and lets them take it in one click."
    >
      <Prose>
        <h2>Why we built it</h2>
        <p>
          Small outbound teams lose deals in the gaps: a reply nobody answered, a
          follow-up that slipped, a hot lead buried under a list of cold ones. The
          data to catch those moments is already in your pipeline. It just is not
          organized around what to do about it.
        </p>
        <p>
          OutboundOS reads every lead, email and reply, ranks the actions that
          matter most, explains why, and puts the button to do each one right next
          to it.
        </p>

        <h2>Who it is for</h2>
        <ul>
          <li>Sales teams of two to twenty-five people doing cold outreach to businesses.</li>
          <li>Teams that send from their own Microsoft 365 mailboxes and want to keep them healthy.</li>
          <li>Teams that live in Salesforce and want outreach activity logged there automatically.</li>
        </ul>

        <h2>How we work</h2>
        <ul>
          <li>
            <strong>Your mailboxes, your reputation.</strong> Email goes out from your
            own accounts with sensible daily limits, domain health checks and one-click
            unsubscribe on every message.
          </li>
          <li>
            <strong>AI that shows its work.</strong> Every score and suggestion comes
            with the reasoning behind it, and nothing sends until you approve it.
          </li>
          <li>
            <strong>Plays by the rules.</strong> No fake engagement, no scraping, and
            built-in checks so you never email existing customers or people who opted
            out.
          </li>
        </ul>
      </Prose>

      <div className="mt-12">
        <Link href="/sign-up" className={PRIMARY_BUTTON}>
          Start free trial
          <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </MarketingPage>
  )
}
