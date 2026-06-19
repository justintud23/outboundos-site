'use client'

import { useState } from 'react'
import { Plus, Trash2, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { SubjectVariantDTO, SubjectVariantTestDTO } from '@/features/sequences/types'

interface SubjectAbTestProps {
  stepId: string
  variants: SubjectVariantDTO[]
  winningVariantId: string | null
  stats: SubjectVariantTestDTO | null
}

// Below this many sends a rate is too thin to mean anything — we de-emphasize the
// percentage and lean on the raw "x/y" so nobody reads "100% off 1 send" as a win.
const LOW_SAMPLE = 20

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`
}

export function SubjectAbTest({ stepId, variants, winningVariantId, stats }: SubjectAbTestProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(variants.map((v) => [v.id, v.subject])),
  )
  const [newSubject, setNewSubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Something went wrong')
        setBusy(false)
        return
      }
      window.location.reload()
    } catch {
      setError('Network error')
      setBusy(false)
    }
  }

  const addVariant = () => {
    const subject = newSubject.trim()
    if (!subject) return
    call(`/api/sequences/steps/${stepId}/variants`, 'POST', { subject })
  }
  const saveVariant = (id: string) => call(`/api/sequences/variants/${id}`, 'PATCH', { subject: drafts[id]?.trim() })
  const removeVariant = (id: string) => call(`/api/sequences/variants/${id}`, 'DELETE')
  const pickWinner = (variantId: string | null) => call(`/api/sequences/steps/${stepId}/winner`, 'POST', { variantId })

  const activeCount = variants.length
  const hasTest = activeCount >= 2 || winningVariantId !== null

  return (
    <div className="mt-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[var(--text-primary)] text-sm font-semibold">Subject A/B test</h3>
          {winningVariantId && <Badge variant="success">Winner picked</Badge>}
        </div>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          Test 2+ subject lines for the first email. Sends split evenly; you pick the winner —
          rates are shown as raw counts, with no statistical-significance claim. Follow-ups thread
          as &ldquo;Re: &hellip;&rdquo; and are not tested.
        </p>
      </div>

      {/* Variant editor */}
      <div className="space-y-2">
        {variants.map((v) => {
          const changed = (drafts[v.id] ?? '') !== v.subject
          const isWinner = winningVariantId === v.id
          return (
            <div key={v.id} className="flex items-center gap-2">
              <Input
                value={drafts[v.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [v.id]: e.target.value }))}
                disabled={busy}
                aria-label="Variant subject"
              />
              {isWinner && <Trophy className="w-4 h-4 text-[var(--status-success)] shrink-0" aria-label="Winner" />}
              {changed && (
                <Button size="sm" variant="outline" onClick={() => saveVariant(v.id)} disabled={busy}>
                  Save
                </Button>
              )}
              <button
                onClick={() => removeVariant(v.id)}
                disabled={busy}
                aria-label="Remove variant"
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )
        })}

        <div className="flex items-center gap-2">
          <Input
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder="Add another subject line…"
            disabled={busy}
            onKeyDown={(e) => e.key === 'Enter' && addVariant()}
            aria-label="New variant subject"
          />
          <Button size="sm" variant="outline" onClick={addVariant} disabled={busy || !newSubject.trim()}>
            <Plus className="w-4 h-4" /> Add
          </Button>
        </div>

        {!hasTest && (
          <p className="text-[var(--text-muted)] text-xs">
            Fewer than 2 variants — no test running. The step&rsquo;s subject is used as normal.
          </p>
        )}
      </div>

      {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}

      {/* Results */}
      {hasTest && stats && stats.variants.length > 0 && (
        <div className="border-t border-[var(--border-default)] pt-4">
          <h4 className="text-[var(--text-secondary)] text-xs font-medium mb-2">Results</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--text-muted)] text-left">
                  <th className="font-medium py-1.5 pr-3">Subject</th>
                  <th className="font-medium py-1.5 px-3 text-right">Sent</th>
                  <th className="font-medium py-1.5 px-3 text-right">Opened</th>
                  <th className="font-medium py-1.5 px-3 text-right">Replied</th>
                  <th className="font-medium py-1.5 pl-3"></th>
                </tr>
              </thead>
              <tbody>
                {stats.variants.map((s) => {
                  const lowSample = s.sent < LOW_SAMPLE
                  const isWinner = winningVariantId === s.id
                  return (
                    <tr
                      key={s.id}
                      className="border-t border-[var(--border-subtle)] text-[var(--text-secondary)]"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          {isWinner && <Trophy className="w-3.5 h-3.5 text-[var(--status-success)] shrink-0" />}
                          <span className={isWinner ? 'text-[var(--text-primary)] font-medium' : ''}>
                            {s.subject}
                          </span>
                          {s.isArchived && <Badge variant="muted">archived</Badge>}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{s.sent}</td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        <span className="text-[var(--text-primary)]">{s.opened}/{s.sent}</span>{' '}
                        {s.sent > 0 && (
                          <span className={lowSample ? 'text-[var(--text-muted)]' : ''}>({pct(s.openRate)})</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        <span className="text-[var(--text-primary)]">{s.replied}/{s.sent}</span>{' '}
                        {s.sent > 0 && (
                          <span className={lowSample ? 'text-[var(--text-muted)]' : ''}>({pct(s.replyRate)})</span>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        {!s.isArchived &&
                          (isWinner ? (
                            <Button size="sm" variant="ghost" onClick={() => pickWinner(null)} disabled={busy}>
                              Resume split
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => pickWinner(s.id)} disabled={busy}>
                              Mark winner
                            </Button>
                          ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {stats.variants.some((s) => s.sent > 0 && s.sent < LOW_SAMPLE) && (
            <p className="text-[var(--text-muted)] text-xs mt-2">
              Rates in grey are off small samples — read the raw counts, not the percentage.
            </p>
          )}
          {winningVariantId && (
            <p className="text-[var(--text-muted)] text-xs mt-2">
              Only the winner is assigned to new sends. Queued and already-sent emails are unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
