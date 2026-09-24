'use client'

import { Fragment, useState } from 'react'
import { useRouter } from 'next/navigation'
import { StatCard } from '@/components/ui/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  LazyResponsiveContainer, LazyLineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from '@/components/charts/recharts-wrapper'
import { relativeTime, formatEnumLabel } from '@/lib/format'
import type { DeliverabilityOverview, DomainRowDTO, MailboxRowDTO } from '../types'
import type { CheckResult } from '../evaluate-domain'
import type { DomainStatusName, MailboxState } from '../readiness'
import type { RampPresetName } from '@/features/mailboxes/warmup'

const DOMAIN_STATUS_VARIANT: Record<DomainStatusName, 'success' | 'warning' | 'danger' | 'muted'> = {
  HEALTHY: 'success',
  WARNING: 'warning',
  FAILING: 'danger',
  UNVERIFIED: 'muted',
}

const CHECK_VARIANT: Record<CheckResult, 'success' | 'warning' | 'danger' | 'muted'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  info: 'muted',
}

const MAILBOX_STATE_VARIANT: Record<MailboxState, 'success' | 'default' | 'warning' | 'danger'> = {
  READY: 'success',
  RAMPING: 'default',
  PAUSED: 'warning',
  BLOCKED: 'danger',
  NEEDS_ATTENTION: 'danger',
}

const RAMP_PRESET_OPTIONS: { value: RampPresetName; label: string }[] = [
  { value: 'CONSERVATIVE', label: 'Conservative' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'AGGRESSIVE', label: 'Aggressive' },
]

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface Props {
  overview: DeliverabilityOverview
}

export function DeliverabilityClient({ overview }: Props) {
  const router = useRouter()
  const { summary, domains, mailboxes, trend, trendByMailbox } = overview

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [regDrafts, setRegDrafts] = useState<Record<string, string>>({})
  const [trendMailboxId, setTrendMailboxId] = useState<string>('all')

  function setRowBusy(key: string, value: boolean) {
    setBusy((prev) => ({ ...prev, [key]: value }))
  }

  async function runAction(key: string, request: () => Promise<Response>, fallbackMessage: string) {
    setError(null)
    setRowBusy(key, true)
    try {
      const res = await request()
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? fallbackMessage)
        return
      }
      router.refresh()
    } catch {
      setError(fallbackMessage)
    } finally {
      setRowBusy(key, false)
    }
  }

  async function recheckDomain(domain: DomainRowDTO) {
    await runAction(
      domain.id,
      () => fetch(`/api/deliverability/domains/${domain.id}/recheck`, { method: 'POST' }),
      'Could not check this domain.',
    )
  }

  async function saveRegisteredAt(domain: DomainRowDTO) {
    const value = regDrafts[domain.id]
    if (!value) return
    await runAction(
      `${domain.id}-date`,
      () => fetch(`/api/deliverability/domains/${domain.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registeredAt: value }),
      }),
      'Could not save the registration date.',
    )
  }

  async function changeRampPreset(mailbox: MailboxRowDTO, rampPreset: RampPresetName) {
    await runAction(
      mailbox.id,
      () => fetch(`/api/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rampPreset }),
      }),
      'Could not update the ramp preset.',
    )
  }

  async function restartRamp(mailbox: MailboxRowDTO) {
    if (!window.confirm(`Restart the ramp for ${mailbox.email} from day 1?`)) return
    await runAction(
      `${mailbox.id}-restart`,
      () => fetch(`/api/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restartRamp: true }),
      }),
      'Could not restart the ramp.',
    )
  }

  async function resumeMailbox(mailbox: MailboxRowDTO) {
    await runAction(
      `${mailbox.id}-resume`,
      () => fetch(`/api/mailboxes/${mailbox.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: true }),
      }),
      'Could not resume this mailbox.',
    )
  }

  const domainsHealthy = summary.domains.HEALTHY + summary.domains.WARNING
  const domainsTotal = summary.domains.HEALTHY + summary.domains.WARNING + summary.domains.FAILING + summary.domains.UNVERIFIED

  const trendData = trendMailboxId === 'all' ? trend : (trendByMailbox[trendMailboxId] ?? [])
  const trendEmpty = trendData.length === 0 || trendData.every((p) => p.sent === 0 && p.bounces === 0 && p.replies === 0)

  return (
    <div className="space-y-8">
      {error && <p role="alert" className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-card)] px-4 py-3">{error}</p>}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Domains"
          value={domainsHealthy}
          sub={`${domainsHealthy} of ${domainsTotal} healthy · ${summary.domains.FAILING} failing, ${summary.domains.UNVERIFIED} unverified`}
        />
        <StatCard
          label="Mailboxes"
          value={summary.mailboxes.READY}
          sub={`${summary.mailboxes.READY} ready · ${summary.mailboxes.RAMPING} ramping, ${summary.mailboxes.PAUSED} paused, ${summary.mailboxes.BLOCKED} blocked`}
        />
        <StatCard
          label="Capacity today"
          value={summary.capacityToday}
          sub={`${summary.capacityToday}/day · ${summary.queuedNext24h} queued (next 24h)`}
        />
        <StatCard
          label="14 days"
          value={summary.sent14}
          sub={`${summary.sent14} sent · ${pct(summary.bounceRate14)} bounce, ${pct(summary.replyRate14)} reply`}
        />
      </div>

      {/* Domains table */}
      <section>
        <h2 className="text-[var(--text-primary)] font-semibold text-sm mb-3">
          Domains
          <span className="ml-2 text-[var(--text-muted)] font-normal">{domains.length}</span>
        </h2>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          {domains.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[var(--text-muted)] text-sm">No sending domains yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)]">
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Domain</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Checks</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Age</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Last checked</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {domains.map((domain) => {
                    const needsRegistration = !domain.registeredAt || domain.registeredAtSource !== 'rdap'
                    const nonPassChecks = domain.checks.filter((c) => c.result !== 'pass')
                    return (
                      <Fragment key={domain.id}>
                        <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0 align-top">
                          <td className="py-3 px-4 text-[var(--text-primary)] font-medium">{domain.domain}</td>
                          <td className="py-3 px-4"><Badge variant={DOMAIN_STATUS_VARIANT[domain.status]}>{formatEnumLabel(domain.status)}</Badge></td>
                          <td className="py-3 px-4">
                            {domain.checks.length === 0 ? (
                              <span className="text-[var(--text-muted)] text-xs">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {(['SPF', 'DKIM', 'MX', 'DMARC'] as const).map((record) => {
                                  const check = domain.checks.find((c) => c.record === record)
                                  if (!check) return null
                                  return (
                                    <Badge
                                      key={record}
                                      variant={CHECK_VARIANT[check.result]}
                                      showIcon
                                      aria-label={`${record}: ${check.result}`}
                                    >
                                      {record}
                                    </Badge>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {domain.registeredAt ? (
                              <span className="text-[var(--text-secondary)]">{formatDate(domain.registeredAt)}</span>
                            ) : domain.young ? (
                              <Badge variant="warning">Young</Badge>
                            ) : (
                              <span className="text-[var(--text-muted)]">unknown</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {domain.lastCheckedAt ? (
                              <span className="text-[var(--text-muted)]">{relativeTime(new Date(domain.lastCheckedAt))}</span>
                            ) : domain.lastError ? (
                              <span className="text-[var(--status-danger)]">{domain.lastError}</span>
                            ) : (
                              <span className="text-[var(--text-muted)]">Never checked</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-2 items-start">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!!busy[domain.id]}
                                  aria-label={`${domain.status === 'UNVERIFIED' ? 'Check now' : 'Recheck now'} for ${domain.domain}`}
                                  onClick={() => void recheckDomain(domain)}
                                >
                                  {domain.status === 'UNVERIFIED' ? 'Check now' : 'Recheck now'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Show fixes for ${domain.domain}`}
                                  onClick={() => setExpanded((prev) => ({ ...prev, [domain.id]: !prev[domain.id] }))}
                                >
                                  {expanded[domain.id] ? 'Hide fixes' : 'Show fixes'}
                                </Button>
                              </div>
                              {needsRegistration && (
                                <div className="flex gap-2 items-center">
                                  <Input
                                    type="date"
                                    aria-label={`Registration date for ${domain.domain}`}
                                    value={regDrafts[domain.id] ?? ''}
                                    onChange={(e) => setRegDrafts((prev) => ({ ...prev, [domain.id]: e.target.value }))}
                                    className="w-36"
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!regDrafts[domain.id] || !!busy[`${domain.id}-date`]}
                                    aria-label={`Save date for ${domain.domain}`}
                                    onClick={() => void saveRegisteredAt(domain)}
                                  >
                                    Save
                                  </Button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded[domain.id] && (
                          <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)]">
                            <td colSpan={6} className="py-3 px-4">
                              {nonPassChecks.length === 0 ? (
                                <p className="text-[var(--text-muted)] text-xs">No issues found.</p>
                              ) : (
                                <ul className="space-y-2">
                                  {nonPassChecks.map((check) => (
                                    <li key={check.record} className="text-xs">
                                      <span className="text-[var(--text-secondary)] font-medium">{check.record}</span>
                                      {check.found && <span className="text-[var(--text-muted)]"> — found: {check.found}</span>}
                                      {check.fix && <p className="text-[var(--text-primary)] mt-0.5">{check.fix}</p>}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Mailboxes table */}
      <section>
        <h2 className="text-[var(--text-primary)] font-semibold text-sm mb-3">
          Mailboxes
          <span className="ml-2 text-[var(--text-muted)] font-normal">{mailboxes.length}</span>
        </h2>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          {mailboxes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-[var(--text-muted)] text-sm">No mailboxes yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)]">
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Mailbox</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Domain</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Preset</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Ramp</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Today</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">14 days</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">State</th>
                    <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mailboxes.map((mailbox) => (
                    <tr key={mailbox.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] last:border-0 align-top">
                      <td className="py-3 px-4">
                        <p className="text-[var(--text-primary)]">{mailbox.email}</p>
                        <p className="text-[var(--text-muted)] text-xs">{mailbox.displayName}</p>
                      </td>
                      <td className="py-3 px-4">
                        {mailbox.domainStatus ? (
                          <Badge variant={DOMAIN_STATUS_VARIANT[mailbox.domainStatus]}>{formatEnumLabel(mailbox.domainStatus)}</Badge>
                        ) : (
                          <span className="text-[var(--text-muted)] text-xs">—</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Select
                          aria-label={`Ramp preset for ${mailbox.email}`}
                          value={mailbox.rampPreset}
                          disabled={!!busy[mailbox.id]}
                          onChange={(e) => void changeRampPreset(mailbox, e.target.value as RampPresetName)}
                        >
                          {RAMP_PRESET_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                        {mailbox.warmupEnabled ? `Day ${mailbox.rampDay} / ${mailbox.rampFullDay - 1}` : 'Ramp off'}
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--text-secondary)] tabular-nums">{mailbox.sentToday} / {mailbox.todayLimit}</td>
                      <td className="py-3 px-4 text-xs text-[var(--text-secondary)]">
                        {mailbox.sent14} sent · {pct(mailbox.bounceRate)} bounce, {pct(mailbox.replyRate)} reply
                      </td>
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          <Badge variant={MAILBOX_STATE_VARIANT[mailbox.state]}>{formatEnumLabel(mailbox.state)}</Badge>
                          <p className="text-[var(--text-muted)] text-xs">{mailbox.detail}</p>
                          {mailbox.readyOn && <p className="text-[var(--text-muted)] text-xs">ready ~{formatDate(mailbox.readyOn)}</p>}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!busy[`${mailbox.id}-restart`]}
                            aria-label={`Restart ramp for ${mailbox.email}`}
                            onClick={() => void restartRamp(mailbox)}
                          >
                            Restart ramp
                          </Button>
                          {mailbox.autoPaused && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!busy[`${mailbox.id}-resume`]}
                              aria-label={`Resume sending for ${mailbox.email}`}
                              onClick={() => void resumeMailbox(mailbox)}
                            >
                              Resume
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Trend */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">14-day trend</h2>
          <Select aria-label="Trend mailbox" value={trendMailboxId} onChange={(e) => setTrendMailboxId(e.target.value)}>
            <option value="all">All mailboxes</option>
            {mailboxes.map((mailbox) => (
              <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>
            ))}
          </Select>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)]">
          {trendEmpty ? (
            <p className="text-[var(--text-muted)] text-sm text-center py-12">No sends in the last 14 days yet</p>
          ) : (
            <LazyResponsiveContainer width="100%" height={280}>
              <LazyLineChart data={trendData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis
                  dataKey="day"
                  tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={35} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                <Line type="monotone" dataKey="sent" stroke="var(--chart-sent)" strokeWidth={2} dot={false} name="Sent" />
                <Line type="monotone" dataKey="bounces" stroke="var(--status-danger)" strokeWidth={2} dot={false} name="Bounces" />
                <Line type="monotone" dataKey="replies" stroke="var(--chart-replied)" strokeWidth={2} dot={false} name="Replies" />
              </LazyLineChart>
            </LazyResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  )
}
