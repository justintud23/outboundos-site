// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { SalesforceStatusDTO } from '@/features/salesforce/server/settings'

const push = vi.fn()
const refresh = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => search,
}))

import { SalesforceCard } from './salesforce-card'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  search = new URLSearchParams()
})

const notConnected: SalesforceStatusDTO = {
  configured: true,
  connected: false,
  status: null,
  username: null,
  instanceUrl: null,
  loginHost: null,
  lastError: null,
  rateLimitedUntil: null,
  customerAccountTypes: ['Customer'],
  blockOpenOpportunities: true,
  logActivity: true,
  counts: { synced24h: 0, pending: 0, failed: 0 },
  recentFailures: [],
}

const connected: SalesforceStatusDTO = {
  configured: true,
  connected: true,
  status: 'CONNECTED',
  username: 'admin@example.com',
  instanceUrl: 'https://my.salesforce.com',
  loginHost: 'https://login.salesforce.com',
  lastError: null,
  rateLimitedUntil: null,
  customerAccountTypes: ['Customer', 'Key Account'],
  blockOpenOpportunities: true,
  logActivity: true,
  counts: { synced24h: 4, pending: 2, failed: 1 },
  recentFailures: [
    { id: 'job-1', type: 'LOG_SEND', leadEmail: 'lead1@acme.com', lastError: 'Duplicate task', updatedAt: '2026-09-28T00:00:00.000Z' },
  ],
}

describe('SalesforceCard', () => {
  it('shows only the not-configured message when Salesforce is not configured', () => {
    render(<SalesforceCard status={{ ...notConnected, configured: false }} isAdmin />)

    expect(screen.getByText("Salesforce isn't configured on this server.")).toBeInTheDocument()
    expect(screen.queryByText('Connect Salesforce')).not.toBeInTheDocument()
  })

  it('admin, not connected: the connect link defaults to production and switches to sandbox', () => {
    render(<SalesforceCard status={notConnected} isAdmin />)

    const link = screen.getByRole('link', { name: 'Connect Salesforce' })
    expect(link).toHaveAttribute('href', '/api/integrations/salesforce/connect?env=production')

    fireEvent.click(screen.getByLabelText('Sandbox'))

    expect(screen.getByRole('link', { name: 'Connect Salesforce' })).toHaveAttribute(
      'href',
      '/api/integrations/salesforce/connect?env=sandbox',
    )
  })

  it('connected admin: shows the username, saves the parsed account types, disconnects, and retries a failed job', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/integrations/salesforce/settings') return Promise.resolve(jsonResponse({ ok: true }))
      if (url === '/api/integrations/salesforce') return Promise.resolve(jsonResponse({ ok: true }))
      if (url === '/api/salesforce/jobs/job-1/retry') return Promise.resolve(jsonResponse({ ok: true }))
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('confirm', vi.fn(() => true))

    render(<SalesforceCard status={connected} isAdmin />)

    expect(screen.getByText('Connected as admin@example.com (my.salesforce.com)')).toBeInTheDocument()

    const input = screen.getByLabelText('Account types that count as customers')
    fireEvent.change(input, { target: { value: 'Customer, Key Account' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/integrations/salesforce/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerAccountTypes: ['Customer', 'Key Account'],
          blockOpenOpportunities: true,
          logActivity: true,
        }),
      }),
    )
    expect(await screen.findByText('Saved.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/salesforce/jobs/job-1/retry', { method: 'POST' }),
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(window.confirm).toHaveBeenCalledWith(
      'Disconnect Salesforce? Syncing stops; records already in Salesforce stay.',
    )
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/integrations/salesforce', { method: 'DELETE' }),
    )
  })

  it('does not disconnect when the confirm dialog is cancelled', () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    render(<SalesforceCard status={connected} isAdmin />)

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the NEEDS_RECONNECT banner with a Reconnect button for admins', () => {
    render(<SalesforceCard status={{ ...connected, status: 'NEEDS_RECONNECT' }} isAdmin />)

    expect(
      screen.getByText('Salesforce needs to be reconnected. Activity logging and customer checks are paused.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toBeInTheDocument()
  })

  it('falls back to the username alone when instanceUrl is not a valid URL (M4)', () => {
    render(<SalesforceCard status={{ ...connected, instanceUrl: 'not a url' }} isAdmin={false} />)
    expect(screen.getByText('Connected as admin@example.com')).toBeInTheDocument()
  })

  it('falls back to the username alone when instanceUrl is null (M4)', () => {
    render(<SalesforceCard status={{ ...connected, instanceUrl: null }} isAdmin={false} />)
    expect(screen.getByText('Connected as admin@example.com')).toBeInTheDocument()
  })

  it('Reconnect for a production connection uses env=production', () => {
    render(<SalesforceCard status={{ ...connected, status: 'NEEDS_RECONNECT' }} isAdmin />)
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/api/integrations/salesforce/connect?env=production',
    )
  })

  it('Reconnect for a sandbox connection uses env=sandbox (I5)', () => {
    render(
      <SalesforceCard
        status={{ ...connected, status: 'NEEDS_RECONNECT', loginHost: 'https://test.salesforce.com' }}
        isAdmin
      />,
    )
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/api/integrations/salesforce/connect?env=sandbox',
    )
  })

  it('shows the connected_new_org message from the query param', () => {
    search = new URLSearchParams('salesforce=connected_new_org')
    render(<SalesforceCard status={connected} isAdmin />)

    expect(
      screen.getByText(
        'Salesforce connected. This is a different Salesforce org than before, so existing lead links were cleared.',
      ),
    ).toBeInTheDocument()
  })

  it('shows a mapped error message from the query param', () => {
    search = new URLSearchParams('salesforce=error&reason=denied')
    render(<SalesforceCard status={notConnected} isAdmin />)

    expect(screen.getByText("Salesforce access wasn't approved.")).toBeInTheDocument()
  })

  it('a member sees the status line and health counts but no buttons, form, or retry', () => {
    render(<SalesforceCard status={connected} isAdmin={false} />)

    expect(screen.getByText('Connected as admin@example.com (my.salesforce.com)')).toBeInTheDocument()
    expect(screen.getByText('Last 24 hours: 4 synced. 2 pending, 1 failed.')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Account types that count as customers')).not.toBeInTheDocument()
  })
})
