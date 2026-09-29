// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const openOrganizationProfile = vi.fn()
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ openOrganizationProfile }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { TeamSection } from './team-section'
import { MySettings } from './my-settings'
import { OwnershipBanner } from './ownership-banner'
import { SettingsClient } from '@/app/(dashboard)/settings/settings-client'
import type { TeamDTO } from '@/features/team/server/team-settings'
import type { SalesforceStatusDTO } from '@/features/salesforce/server/settings'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
})

const team: TeamDTO = {
  members: [
    { id: 'm-1', name: 'Alice', email: 'alice@x.com', role: 'admin', escalationEmail: null, senderFirstName: 'Alice', senderLastName: null, mailboxCount: 2, lastSeenAt: null },
    { id: 'm-2', name: 'Bob', email: 'bob@x.com', role: 'member', escalationEmail: 'bob-alerts@x.com', senderFirstName: null, senderLastName: null, mailboxCount: 0, lastSeenAt: null },
  ],
  copyAdminOnReplies: true,
  unassignedCampaigns: 2,
  unassignedMailboxes: 1,
  bannerDismissed: false,
}

describe('TeamSection', () => {
  it('lists members with role and mailbox count (admin view)', () => {
    render(<TeamSection team={team} isAdmin />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('2 mailboxes')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('member')).toBeInTheDocument()
    expect(screen.getByText('0 mailboxes')).toBeInTheDocument()
  })

  it('lists members with role and mailbox count (member view, read-only)', () => {
    render(<TeamSection team={team} isAdmin={false} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('2 mailboxes')).toBeInTheDocument()
    // No editable inputs for a non-admin.
    expect(screen.queryByPlaceholderText('Escalation email')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('shows the "Roles are managed in Clerk" note', () => {
    render(<TeamSection team={team} isAdmin />)
    expect(screen.getByText(/Roles are managed in Clerk/)).toBeInTheDocument()
  })

  it('admins see a "Manage roles in Clerk" button that opens the Clerk org profile', () => {
    render(<TeamSection team={team} isAdmin />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage roles in Clerk' }))
    expect(openOrganizationProfile).toHaveBeenCalled()
  })

  it('members do not see the "Manage roles in Clerk" button', () => {
    render(<TeamSection team={team} isAdmin={false} />)
    expect(screen.queryByRole('button', { name: 'Manage roles in Clerk' })).not.toBeInTheDocument()
  })

  it('the copy toggle PATCHes /api/team/settings', async () => {
    render(<TeamSection team={team} isAdmin />)
    const toggle = screen.getByRole('checkbox')
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/team/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyAdminOnReplies: false }),
      }),
    )
  })

  it('reverts the toggle and shows an alert when the PATCH fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Nope' }), { status: 400 }))
    render(<TeamSection team={team} isAdmin />)
    const toggle = screen.getByRole('checkbox') as HTMLInputElement

    fireEvent.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    await waitFor(() => expect(toggle.checked).toBe(true))
  })

  it('admin can save escalation email and sender names for another member', async () => {
    render(<TeamSection team={team} isAdmin />)

    fireEvent.change(screen.getByLabelText('Bob escalation email'), { target: { value: 'new-alerts@x.com' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!)

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/team/members/m-2', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escalationEmail: 'new-alerts@x.com', senderFirstName: '', senderLastName: '' }),
      }),
    )
  })
})

describe('MySettings', () => {
  it('saves the escalation email and sender names', async () => {
    render(<MySettings memberId="m-1" escalationEmail={null} senderFirstName={null} senderLastName={null} />)

    fireEvent.change(screen.getByLabelText('Escalation email'), { target: { value: 'me@x.com' } })
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Al' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Jones' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/team/members/m-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escalationEmail: 'me@x.com', senderFirstName: 'Al', senderLastName: 'Jones' }),
      }),
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows errors in role="alert"', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid escalation email' }), { status: 400 }))
    render(<MySettings memberId="m-1" escalationEmail={null} senderFirstName={null} senderLastName={null} />)

    const emailInput = screen.getByLabelText('Escalation email')
    fireEvent.change(emailInput, { target: { value: 'nope' } })
    // fireEvent.submit dispatches the submit event directly, bypassing the
    // browser's native <input type="email"> constraint validation that a
    // real click on the submit button would trigger for an invalid value —
    // the server-side validity check is what this test exercises.
    fireEvent.submit(emailInput.closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid escalation email')
  })

  it('pre-fills from the current values', () => {
    render(<MySettings memberId="m-1" escalationEmail="me@x.com" senderFirstName="Al" senderLastName="Jones" />)
    expect(screen.getByLabelText('Escalation email')).toHaveValue('me@x.com')
    expect(screen.getByLabelText('First name')).toHaveValue('Al')
    expect(screen.getByLabelText('Last name')).toHaveValue('Jones')
  })
})

describe('OwnershipBanner', () => {
  it('renders for an admin with unassigned items, linking to campaigns and settings', () => {
    render(<OwnershipBanner isAdmin dismissed={false} unassignedCampaigns={2} unassignedMailboxes={1} />)
    expect(screen.getByRole('link', { name: 'Assign campaigns' })).toHaveAttribute('href', '/campaigns?view=team')
    expect(screen.getByRole('link', { name: 'Assign mailboxes' })).toHaveAttribute('href', '/settings')
  })

  it('does not render for a non-admin', () => {
    const { container } = render(<OwnershipBanner isAdmin={false} dismissed={false} unassignedCampaigns={2} unassignedMailboxes={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not render once dismissed', () => {
    const { container } = render(<OwnershipBanner isAdmin dismissed unassignedCampaigns={2} unassignedMailboxes={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not render when nothing is unassigned', () => {
    const { container } = render(<OwnershipBanner isAdmin dismissed={false} unassignedCampaigns={0} unassignedMailboxes={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('Dismiss PATCHes { dismissOwnershipBanner: true } and then hides the banner', async () => {
    render(<OwnershipBanner isAdmin dismissed={false} unassignedCampaigns={2} unassignedMailboxes={1} />)

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/team/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissOwnershipBanner: true }),
      }),
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument())
  })
})

describe('SettingsClient — non-admin', () => {
  const currentMember = { id: 'm-2', escalationEmail: 'bob-alerts@x.com', senderFirstName: null, senderLastName: null }

  const salesforceStatus: SalesforceStatusDTO = {
    configured: false,
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

  it('shows the sending, business-profile and mailbox sections read-only or hidden, with no errors', () => {
    render(
      <SettingsClient
        initialMailboxes={[]}
        sendingSettings={null}
        businessProfile={null}
        isAdmin={false}
        members={[]}
        team={team}
        salesforceStatus={salesforceStatus}
        currentMember={currentMember}
      />,
    )

    // The admin-only sections never mount for a non-admin.
    expect(screen.queryByText('Sending schedule')).not.toBeInTheDocument()
    expect(screen.queryByText('Add mailbox')).not.toBeInTheDocument()
    expect(screen.getByText('Ask an admin to change these settings.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // My settings and the team roster are still available.
    expect(screen.getByText('My settings')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
  })
})
