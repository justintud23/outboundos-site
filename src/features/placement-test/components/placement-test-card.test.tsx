// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlacementTestCard } from './placement-test-card'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

const SEQUENCES = [{ id: 'seq-1', name: 'Intro sequence' }]
const MAILBOXES = [{ id: 'mb-1', email: 'rep@company.com' }]
const LEADS = [{ id: 'lead-1', label: 'Bob Builder' }]

describe('PlacementTestCard', () => {
  it('renders the labelled controls', () => {
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)
    expect(screen.getByLabelText(/sequence/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/send from/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/sample lead/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/seed addresses/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send test/i })).toBeInTheDocument()
    expect(screen.getByText(/built-in sample \(jane at acme property group\)/i)).toBeInTheDocument()
  })

  it('the button is disabled with an empty textarea', () => {
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)
    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled()
  })

  it('posts the right body, including parsed seeds, and shows the success summary', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ mailbox: 'rep@company.com', requested: 2, sent: 2, failed: [] }), { status: 200 }))
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)

    fireEvent.change(screen.getByLabelText(/seed addresses/i), { target: { value: 'a@tester.com, b@tester.com\nb@tester.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/campaigns/camp-1/placement-test',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ sequenceId: 'seq-1', mailboxId: 'mb-1', leadId: null, seeds: ['a@tester.com', 'b@tester.com', 'b@tester.com'] }),
        }),
      ),
    )
    expect(await screen.findByText(/sent to 2 of 2 seed addresses from rep@company\.com/i)).toBeInTheDocument()
  })

  it('shows a failure list alongside the success summary', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ mailbox: 'rep@company.com', requested: 2, sent: 1, failed: [{ to: 'bad@tester.com', error: 'Graph 503' }] }), { status: 200 }),
    )
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)
    fireEvent.change(screen.getByLabelText(/seed addresses/i), { target: { value: 'bad@tester.com\ngood@tester.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    expect(await screen.findByText(/sent to 1 of 2/i)).toBeInTheDocument()
    expect(screen.getByRole('listitem')).toHaveTextContent('bad@tester.com: Graph 503')
  })

  it('shows the server error in an alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Only 1 sends left today on rep@company.com.' }), { status: 429 }))
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)
    fireEvent.change(screen.getByLabelText(/seed addresses/i), { target: { value: 'a@tester.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send test/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 sends left today on rep@company.com.')
  })

  it('resets busy state in finally even when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    render(<PlacementTestCard campaignId="camp-1" sequences={SEQUENCES} mailboxes={MAILBOXES} leads={LEADS} msConnected />)
    fireEvent.change(screen.getByLabelText(/seed addresses/i), { target: { value: 'a@tester.com' } })
    const button = screen.getByRole('button', { name: /send test/i })
    fireEvent.click(button)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('shows the Microsoft 365 note when not connected, instead of the form', () => {
    render(<PlacementTestCard campaignId="camp-1" sequences={[]} mailboxes={[]} leads={[]} msConnected={false} />)
    expect(screen.getByText(/connect microsoft 365 in settings/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send test/i })).not.toBeInTheDocument()
  })

  it('disables the button with no sequences or mailboxes', () => {
    render(<PlacementTestCard campaignId="camp-1" sequences={[]} mailboxes={MAILBOXES} leads={[]} msConnected />)
    expect(screen.getByRole('button', { name: /send test/i })).toBeDisabled()
  })
})
