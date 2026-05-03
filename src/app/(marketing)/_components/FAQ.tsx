'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

const QUESTIONS = [
  {
    q: 'How is this different from Smartlead or Instantly?',
    a: 'Smartlead and Instantly are great at sending email at scale — but they leave you alone with the inbox. OutboundOS is the layer on top: a Decision Engine that ranks every action across drafts, replies, and stale leads, plus a Lead Command Center to execute without leaving the page. Think of us as the cockpit, not another sending tool.',
  },
  {
    q: 'Do you handle deliverability and inbox warmup?',
    a: 'Today we recommend pairing OutboundOS with your existing sending infrastructure (Smartlead, Instantly, or your own SMTP setup). Native multi-inbox sending and warmup are on our roadmap — we want to do them right rather than bolt on a half-measure.',
  },
  {
    q: 'Can I import my existing lead lists?',
    a: 'Yes. Upload a CSV and our AI scores each lead 0–100 with reasoning, so you know who to prioritize on day one. We handle dedupe, enrichment hooks, and field mapping automatically.',
  },
  {
    q: 'What email providers do you support?',
    a: 'Gmail and Google Workspace today, with Microsoft 365 / Outlook in active development. If you have a custom provider or sending tool, talk to us during the demo — we integrate via API in most cases.',
  },
  {
    q: 'Is there a free trial?',
    a: 'We offer a 14-day trial on the Starter and Growth plans, no credit card required. For Scale and Agency tiers, we run a guided pilot so we can hand-tune the Decision Engine to your ICP before you commit.',
  },
  {
    q: 'How fast can I get started?',
    a: 'Most teams are sending their first prioritized actions within a single working session. CSV import, Gmail connection, and your first AI-drafted sequence take about 30 minutes end-to-end.',
  },
]

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className="border-t border-white/5 py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Frequently asked questions
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-300">
            The questions every founder asks before booking a demo.
          </p>
        </div>

        <div className="mt-12 divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-[var(--bg-surface)]/60 backdrop-blur">
          {QUESTIONS.map((item, idx) => {
            const isOpen = open === idx
            const panelId = `faq-panel-${idx}`
            const buttonId = `faq-button-${idx}`
            return (
              <div key={item.q}>
                <h3>
                  <button
                    type="button"
                    id={buttonId}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/50"
                  >
                    <span className="text-base font-semibold text-white md:text-lg">
                      {item.q}
                    </span>
                    <ChevronDown
                      size={20}
                      aria-hidden="true"
                      className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="px-6 pb-6 pt-0"
                >
                  <p className="text-sm leading-relaxed text-slate-300 md:text-base">
                    {item.a}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
