import type { VerificationSummaryDTO } from '../types'

export function VerificationCard({ summary }: { summary: VerificationSummaryDTO }) {
  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-3">
      <h2 className="text-[var(--text-primary)] font-semibold text-sm">Email verification</h2>
      {!summary.configured ? (
        <p className="text-[var(--text-muted)] text-sm">
          Verification not configured. Add MILLIONVERIFIER_API_KEY to check addresses before the first email.
        </p>
      ) : (
        <>
          {summary.pausedReason && (
            <p role="alert" className="text-[var(--status-danger)] text-sm">
              Verification paused: {summary.pausedReason}. First emails wait until it resumes.
            </p>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['Waiting for verification', summary.pending],
              ['Risky (catch-all / unknown)', summary.risky],
              ['Invalid', summary.invalid],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-btn)] border border-[var(--border-default)] p-3">
                <dt className="text-[var(--text-muted)] text-xs">{label}</dt>
                <dd className="text-[var(--text-primary)] text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
