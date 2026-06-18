import { Check, Minus, Clock } from 'lucide-react'

type Cell =
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'partial' }
  | { kind: 'soon' }
  | { kind: 'text'; value: string }

type Row = {
  feature: string
  outboundos: Cell
  smartlead: Cell
  instantly: Cell
  apollo: Cell
}

const COLUMNS = ['OutboundOS', 'Smartlead', 'Instantly', 'Apollo'] as const

const ROWS: Row[] = [
  {
    feature: 'Decision Engine',
    outboundos: { kind: 'yes' },
    smartlead: { kind: 'no' },
    instantly: { kind: 'no' },
    apollo: { kind: 'no' },
  },
  {
    feature: 'AI Reply Classification',
    outboundos: { kind: 'yes' },
    smartlead: { kind: 'yes' },
    instantly: { kind: 'partial' },
    apollo: { kind: 'partial' },
  },
  {
    feature: 'Inline Execution UX',
    outboundos: { kind: 'yes' },
    smartlead: { kind: 'no' },
    instantly: { kind: 'no' },
    apollo: { kind: 'no' },
  },
  {
    feature: 'Lead Command Center',
    outboundos: { kind: 'yes' },
    smartlead: { kind: 'no' },
    instantly: { kind: 'no' },
    apollo: { kind: 'no' },
  },
  {
    feature: 'Multi-Inbox Sending',
    outboundos: { kind: 'soon' },
    smartlead: { kind: 'yes' },
    instantly: { kind: 'yes' },
    apollo: { kind: 'yes' },
  },
  {
    feature: 'Pricing',
    outboundos: { kind: 'text', value: 'Starts at $97/mo' },
    smartlead: { kind: 'text', value: '$94/mo' },
    instantly: { kind: 'text', value: '$87/mo' },
    apollo: { kind: 'text', value: '$99/mo' },
  },
]

function CellContent({ cell }: { cell: Cell }) {
  switch (cell.kind) {
    case 'yes':
      return (
        <span className="inline-flex items-center gap-2 text-[var(--status-success)]">
          <Check size={18} aria-hidden="true" />
          <span className="sr-only">Yes</span>
        </span>
      )
    case 'no':
      return (
        <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
          <Minus size={18} aria-hidden="true" />
          <span className="sr-only">No</span>
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--status-warning)]">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-[var(--status-warning)]"
          />
          Partial
        </span>
      )
    case 'soon':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-indigo)]">
          <Clock size={14} aria-hidden="true" />
          Coming soon
        </span>
      )
    case 'text':
      return <span className="text-sm text-[var(--text-secondary)]">{cell.value}</span>
  }
}

export function ComparisonTable() {
  return (
    <section className="border-t border-[var(--border-subtle)] py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-indigo)]">
            How we compare
          </p>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-[var(--text-primary)] md:text-4xl lg:text-5xl">
            The decision layer no one else has built.
          </h2>
        </div>

        <div className="mt-16 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-card)]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]">
                  <th
                    scope="col"
                    className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]"
                  >
                    Feature
                  </th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={`px-6 py-4 text-xs font-semibold uppercase tracking-wider ${
                        col === 'OutboundOS'
                          ? 'text-[var(--accent-indigo)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, idx) => (
                  <tr
                    key={row.feature}
                    className={
                      idx < ROWS.length - 1
                        ? 'border-b border-[var(--border-subtle)]'
                        : undefined
                    }
                  >
                    <th
                      scope="row"
                      className="px-6 py-5 text-left text-sm font-medium text-[var(--text-primary)]"
                    >
                      {row.feature}
                    </th>
                    <td className="bg-[var(--accent-indigo-glow)] px-6 py-5">
                      <CellContent cell={row.outboundos} />
                    </td>
                    <td className="px-6 py-5">
                      <CellContent cell={row.smartlead} />
                    </td>
                    <td className="px-6 py-5">
                      <CellContent cell={row.instantly} />
                    </td>
                    <td className="px-6 py-5">
                      <CellContent cell={row.apollo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
