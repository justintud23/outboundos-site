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
  },
  {
    icon: PenLine,
    title: 'AI Draft Generation',
    description:
      'GPT-4o writes personalized cold emails. You approve with one click.',
  },
  {
    icon: MessageSquareReply,
    title: 'Reply Intelligence',
    description:
      'Auto-classifies replies as Positive, Negative, OOO, Unsubscribe, or Referral.',
  },
  {
    icon: UserSquare2,
    title: 'Lead Command Center',
    description:
      'Every detail about a lead — timeline, messages, actions — in one place.',
  },
  {
    icon: Workflow,
    title: 'Sequence Automation',
    description:
      'Multi-step email sequences with smart enrollment and exit rules.',
  },
  {
    icon: LineChart,
    title: 'Real-Time Analytics',
    description:
      'Funnel metrics, campaign performance, daily activity trends.',
  },
]

export function FeatureGrid() {
  return (
    <section
      id="features"
      className="border-t border-white/5 py-24 md:py-32"
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
            What&apos;s inside
          </p>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            Everything you need to run outbound — and nothing you don&apos;t.
          </h2>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group relative rounded-xl border border-white/5 bg-[var(--bg-surface)]/60 p-7 backdrop-blur transition-all hover:border-white/10 hover:bg-[var(--bg-surface)]"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-600/20 ring-1 ring-inset ring-indigo-400/20">
                <Icon size={20} className="text-indigo-300" aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
