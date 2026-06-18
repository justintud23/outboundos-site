import {
  Brain,
  PenLine,
  MessageSquareReply,
  UserSquare2,
  Workflow,
  LineChart,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Brain,
    title: 'Decision Engine',
    description:
      'AI prioritizes every action across your pipeline with reasoning and urgency.',
    accent: 'var(--accent-indigo)',
  },
  {
    icon: PenLine,
    title: 'AI Draft Generation',
    description:
      'GPT-4o writes personalized cold emails. You approve with one click.',
    accent: 'var(--accent-magenta)',
  },
  {
    icon: MessageSquareReply,
    title: 'Reply Intelligence',
    description:
      'Auto-classifies replies as Positive, Negative, OOO, Unsubscribe, or Referral.',
    accent: 'var(--accent-cyan)',
  },
  {
    icon: UserSquare2,
    title: 'Lead Command Center',
    description:
      'Every detail about a lead — timeline, messages, actions — in one place.',
    accent: 'var(--accent-warm)',
  },
  {
    icon: Workflow,
    title: 'Sequence Automation',
    description:
      'Multi-step email sequences with smart enrollment and exit rules.',
    accent: 'var(--status-warning)',
  },
  {
    icon: LineChart,
    title: 'Real-Time Analytics',
    description:
      'Funnel metrics, campaign performance, daily activity trends.',
    accent: 'var(--status-success)',
  },
]

export function FeatureGrid() {
  return (
    <section id="features" className="border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-indigo)]">
            What&apos;s inside
          </p>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            Everything you need to run outbound — and nothing you don&apos;t.
          </h2>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description, accent }) => (
            <div
              key={title}
              className="group rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-7 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]"
            >
              <div
                className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] border transition-transform group-hover:scale-105"
                style={{
                  background: `color-mix(in srgb, ${accent} 12%, transparent)`,
                  borderColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
                }}
              >
                <Icon size={20} style={{ color: accent }} aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
