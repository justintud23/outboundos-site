// Explains a profile-scored lead's final `score` on the lead detail page.
// `breakdown` comes straight off `Lead.scoreBreakdown` (a Prisma `Json?`
// column), so it is `unknown` at the boundary — legacy leads have `null`,
// and any hand-edited or partially-written row could be malformed. We
// validate defensively and render nothing rather than throw.

interface ScoreBreakdownPart {
  signal: string
  label: string
  points: number
}

interface ScoreBreakdownData {
  parts: ScoreBreakdownPart[]
  rulesScore: number
  cap: number | null
  aiAdjustment: number | null
  aiReason: string | null
}

interface ScoreBreakdownTableProps {
  breakdown: unknown
}

const SIGNAL_LABELS: Record<string, string> = {
  area: 'Area',
  property: 'Property',
  size: 'Size',
  title: 'Title',
  relationship: 'Relationship',
  ai: 'AI',
}

// Only the area and property signals ever apply a cap (see score-rules.ts) —
// a capped signal's part has 0 points, so the first zero-point part on one
// of those two signals is the one that explains the cap.
const CAPPING_SIGNALS = new Set(['area', 'property'])

function isScorePart(value: unknown): value is ScoreBreakdownPart {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.signal === 'string' && typeof p.label === 'string' && typeof p.points === 'number'
}

function isScoreBreakdown(value: unknown): value is ScoreBreakdownData {
  if (!value || typeof value !== 'object') return false
  const b = value as Record<string, unknown>
  if (!Array.isArray(b.parts) || b.parts.length === 0) return false
  if (!b.parts.every(isScorePart)) return false
  if (typeof b.rulesScore !== 'number') return false
  if (b.cap !== null && typeof b.cap !== 'number') return false
  if (b.aiAdjustment !== null && typeof b.aiAdjustment !== 'number') return false
  return true
}

function formatPoints(points: number): string {
  if (points > 0) return `+${points}`
  if (points < 0) return `-${Math.abs(points)}`
  return '0'
}

export function ScoreBreakdownTable({ breakdown }: ScoreBreakdownTableProps) {
  if (!isScoreBreakdown(breakdown)) return null

  // Matches the clamp scoreLeads.ts applies when persisting `Lead.score` —
  // without it, e.g. rulesScore 100 + AI +15 would display 115 here while
  // the stored score is 100.
  const finalScore = Math.max(0, Math.min(100, breakdown.rulesScore + (breakdown.aiAdjustment ?? 0)))
  const cappingPart =
    breakdown.cap !== null
      ? breakdown.parts.find((p) => CAPPING_SIGNALS.has(p.signal) && p.points === 0)
      : undefined

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)]">
      <div className="px-5 pt-4 pb-2">
        <h2 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider">
          Score Breakdown
        </h2>
      </div>
      <div className="overflow-x-auto px-5 pb-5">
        <table className="w-full text-sm">
          <caption className="text-left text-[var(--text-muted)] text-xs mb-2">
            How this score was calculated
          </caption>
          <thead>
            <tr className="border-b border-[var(--border-default)]">
              <th scope="col" className="text-left py-2 pr-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">
                Signal
              </th>
              <th scope="col" className="text-left py-2 pr-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">
                Detail
              </th>
              <th scope="col" className="text-right py-2 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {breakdown.parts.map((part, i) => (
              <tr key={i} className="border-b border-[var(--border-subtle)]">
                <td className="py-2 pr-3 text-[var(--text-secondary)]">
                  {SIGNAL_LABELS[part.signal] ?? part.signal}
                </td>
                <td className="py-2 pr-3 text-[var(--text-primary)]">{part.label}</td>
                <td className="py-2 text-right text-[var(--text-primary)] tabular-nums">
                  {formatPoints(part.points)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="py-2 pr-3 font-medium text-[var(--text-primary)]">
                Score
              </td>
              <td className="py-2 text-right font-medium text-[var(--text-primary)] tabular-nums">
                {finalScore}
              </td>
            </tr>
            {breakdown.cap !== null && (
              <tr>
                <td colSpan={3} className="pt-1 text-xs text-[var(--text-muted)]">
                  Capped at {breakdown.cap}
                  {cappingPart ? `: ${cappingPart.label}` : ''}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  )
}
