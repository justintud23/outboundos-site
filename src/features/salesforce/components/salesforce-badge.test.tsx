import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { SalesforceBadge } from './salesforce-badge'

const fetchMock = vi.fn()

const baseSalesforce = {
  id: null as string | null,
  type: null as 'LEAD' | 'CONTACT' | null,
  checkStatus: null as string | null,
  checkDetail: null as string | null,
  checkedAt: null as string | null,
  blockOverride: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('SalesforceBadge', () => {
  it('renders a View in Salesforce link when linked', () => {
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin={false}
        salesforce={{ ...baseSalesforce, id: '00Q123' }}
      />,
    )

    const link = screen.getByRole('link', { name: 'View in Salesforce' })
    expect(link).toHaveAttribute('href', 'https://acme.my.salesforce.com/00Q123')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('does not render a link when not linked', () => {
    render(
      <SalesforceBadge instanceUrl="https://acme.my.salesforce.com" leadId="lead-1" isAdmin={false} salesforce={baseSalesforce} />,
    )

    expect(screen.queryByRole('link', { name: 'View in Salesforce' })).not.toBeInTheDocument()
  })

  it('shows "not checked yet" when checkStatus is null', () => {
    render(
      <SalesforceBadge instanceUrl="https://acme.my.salesforce.com" leadId="lead-1" isAdmin={false} salesforce={baseSalesforce} />,
    )

    expect(screen.getByText('Salesforce check: not checked yet')).toBeInTheDocument()
  })

  it('shows the clear status with a relative checked time', () => {
    const checkedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin={false}
        salesforce={{ ...baseSalesforce, checkStatus: 'CLEAR', checkedAt }}
      />,
    )

    expect(screen.getByText('Salesforce check: clear (checked 3h ago)')).toBeInTheDocument()
  })

  it('shows a warning and an Allow anyway button for an admin on a blocking status', () => {
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin
        salesforce={{ ...baseSalesforce, checkStatus: 'CUSTOMER', checkDetail: 'Acme' }}
      />,
    )

    expect(screen.getByText('Salesforce: customer (Acme) Emails to this lead are blocked.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow anyway' })).toBeInTheDocument()
  })

  it('shows a warning without an Allow anyway button for a non-admin member', () => {
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin={false}
        salesforce={{ ...baseSalesforce, checkStatus: 'CUSTOMER', checkDetail: 'Acme' }}
      />,
    )

    expect(screen.getByText('Salesforce: customer (Acme) Emails to this lead are blocked.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow anyway' })).not.toBeInTheDocument()
  })

  it('posts to the override route and refreshes when Allow anyway is clicked', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin
        salesforce={{ ...baseSalesforce, checkStatus: 'CUSTOMER', checkDetail: 'Acme' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Allow anyway' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/leads/lead-1/salesforce-override', { method: 'POST' }),
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('shows the override message and hides the warning when blockOverride is set', () => {
    render(
      <SalesforceBadge
        instanceUrl="https://acme.my.salesforce.com"
        leadId="lead-1"
        isAdmin
        salesforce={{ ...baseSalesforce, checkStatus: 'CUSTOMER', checkDetail: 'Acme', blockOverride: true }}
      />,
    )

    expect(
      screen.getByText('Allowed by an admin despite Salesforce. Re-enroll the lead to resume emailing.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Emails to this lead are blocked\./)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow anyway' })).not.toBeInTheDocument()
  })
})
