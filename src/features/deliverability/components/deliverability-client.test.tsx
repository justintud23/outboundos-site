import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/charts/recharts-wrapper', () => ({
  LazyResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
  LazyLineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null, CartesianGrid: () => null,
}))

import { DeliverabilityClient } from './deliverability-client'
import type { DeliverabilityOverview } from '../types'

const overview: DeliverabilityOverview = {
  summary: {
    domains: { UNVERIFIED: 1, HEALTHY: 0, WARNING: 0, FAILING: 1 },
    mailboxes: { READY: 0, RAMPING: 1, PAUSED: 0, BLOCKED: 1, NEEDS_ATTENTION: 0 },
    capacityToday: 3, queuedNext24h: 5, sent14: 20, bounceRate14: 0.05, replyRate14: 0.1,
  },
  domains: [
    { id: 'dh-1', domain: 'bad.com', status: 'FAILING', checks: [{ record: 'MX', result: 'fail', found: null, fix: 'Point bad.com MX to Microsoft 365' }], registeredAt: null, registeredAtSource: null, young: true, lastCheckedAt: '2026-09-25T10:00:00Z', lastError: null },
    { id: 'dh-2', domain: 'new.com', status: 'UNVERIFIED', checks: [], registeredAt: null, registeredAtSource: null, young: true, lastCheckedAt: null, lastError: null },
  ],
  mailboxes: [
    { id: 'mb-1', email: 'a@new.com', displayName: 'A', domain: 'new.com', domainStatus: 'UNVERIFIED', rampPreset: 'CONSERVATIVE', warmupEnabled: true, rampDay: 2, rampFullDay: 29, todayLimit: 3, sentToday: 1, sent14: 20, bounces14: 1, replies14: 2, bounceRate: 0.05, replyRate: 0.1, state: 'BLOCKED', readyOn: null, detail: 'Domain not verified yet — click Check now', autoPaused: false },
  ],
  trend: [], trendByMailbox: { 'mb-1': [] },
}

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'HEALTHY' }), { status: 200 }))
})

describe('DeliverabilityClient', () => {
  it('shows summary, a failing domain with its fix, and a blocked mailbox with the reason', () => {
    render(<DeliverabilityClient overview={overview} />)
    expect(screen.getByText('bad.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show fixes for bad\.com/i }))
    expect(screen.getByText(/Point bad\.com MX to Microsoft 365/)).toBeInTheDocument()
    expect(screen.getByText(/Domain not verified yet/)).toBeInTheDocument()
  })

  it('"Check now" on an unverified domain POSTs recheck and refreshes', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: /check now.*new\.com/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/deliverability/domains/dh-2/recheck', { method: 'POST' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('a 429 shows the wait message instead of failing silently', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Checked moments ago — try again shortly.', retryAfterSeconds: 42 }), { status: 429 }))
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: /check now.*new\.com/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i)
  })

  it('changing the preset PATCHes the mailbox', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.change(screen.getByLabelText(/ramp preset for a@new\.com/i), { target: { value: 'STANDARD' } })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/mailboxes/mb-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ rampPreset: 'STANDARD' }) })),
    )
  })

  it('exposes each check chip state as text for screen readers, not color alone', () => {
    render(<DeliverabilityClient overview={overview} />)
    expect(screen.getByLabelText('MX: fail')).toBeInTheDocument()
  })

  it('renders registeredAt in UTC so a date entered as 2026-09-01 does not display as Aug 31', () => {
    const withRegisteredAt: DeliverabilityOverview = {
      ...overview,
      domains: [
        { ...overview.domains[0]!, registeredAt: '2026-09-01T00:00:00.000Z', registeredAtSource: 'rdap' },
        overview.domains[1]!,
      ],
    }
    render(<DeliverabilityClient overview={withRegisteredAt} />)
    expect(screen.getByText('Sep 1, 2026')).toBeInTheDocument()
    expect(screen.queryByText('Aug 31, 2026')).not.toBeInTheDocument()
  })

  it('saving a registration date PATCHes the domain', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.change(screen.getByLabelText(/registration date for new\.com/i), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: /save date for new\.com/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/deliverability/domains/dh-2', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ registeredAt: '2026-08-01' }) })),
    )
  })
})
