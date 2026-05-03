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
        <span className="inline-flex items-center gap-2 text-emerald-400">
          <Check size={18} aria-hidden="true" />
          <span className="sr-only">Yes</span>
        </span>
      )
    case 'no':
      return (
        <span className="inline-flex items-center gap-2 text-slate-600">
          <Minus size={18} aria-hidden="true" />
          <span className="sr-only">No</span>
        </span>
      )
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-300">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-amber-400"
          />
          Partial
        </span>
      )
    case 'soon':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300">
          <Clock size={14} aria-hidden="true" />
          Coming soon
        </span>
      )
    case 'text':
      return <span className="text-sm text-slate-200">{cell.value}</span>
  }
}

export function ComparisonTable() {
  return (
    <section className="border-t border-white/5 py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-indigo-400">
            How we compare
          </p>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-white md:text-4xl lg:text-5xl">
            The decision layer no one else has built.
          </h2>
        </div>

        <div className="mt-16 overflow-hidden rounded-xl border border-white/10 bg-[var(--bg-surface)]/60 backdrop-blur">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/5 bg-[var(--bg-surface-raised)]/60">
                  <th
                    scope="col"
                    className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    Feature
                  </th>
                  {COLUMNS.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className={`px-6 py-4 text-xs font-semibold uppercase tracking-wider ${
                        col === 'OutboundOS'
                          ? 'text-indigo-300'
                          : 'text-slate-500'
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
                        ? 'border-b border-white/5'
                        : undefined
                    }
                  >
                    <th
                      scope="row"
                      className="px-6 py-5 text-left text-sm font-medium text-slate-200"
                    >
                      {row.feature}
                    </th>
                    <td className="bg-indigo-500/[0.04] px-6 py-5">
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
