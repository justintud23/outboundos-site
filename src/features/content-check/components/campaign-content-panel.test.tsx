// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CampaignContentPanel } from './campaign-content-panel'
import type { ContentStatusDTO } from '../types'

const high: ContentStatusDTO = {
  level: 'HIGH',
  items: [{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: your lot', body: '', isFirstStep: true, level: 'HIGH', findings: [{ rule: 'fake-reply', severity: 'HIGH', found: 'Re: your lot', fix: 'Remove "Re:"/"Fwd:"' }] }],
  override: null,
}
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('CampaignContentPanel', () => {
  it('shows the worst level, the offending step and its fix', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    expect(screen.getAllByText('High risk').length).toBeGreaterThan(0)
    expect(screen.getByText('Fall — step 1')).toBeInTheDocument()
    expect(screen.getByText(/Remove "Re:"/)).toBeInTheDocument()
    expect(screen.getByText(/Automatic sending can't be turned on, and live edits are refused, while any email is High risk\./)).toBeInTheDocument()
  })

  it('records an override with a reason', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...high, override: { reason: 'Reviewed and approved', by: 'user_1', at: '2026-10-01T00:00:00Z', valid: true } }), { status: 200 }))
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Reviewed and approved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record override' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/camp-1/content-override', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Reviewed and approved' }) }))
  })

  it('shows a server error in an alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Give a reason of 10–500 characters.' }), { status: 400 }))
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record override' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason of 10–500 characters.')
  })

  it('shows a valid override instead of the form', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={{ ...high, override: { reason: 'Reviewed and approved', by: 'user_1', at: '2026-10-01T00:00:00Z', valid: true } }} />)
    expect(screen.getByText(/Override in effect/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Override reason')).not.toBeInTheDocument()
  })

  it('hides the override form when nothing is High', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={{ level: 'LOW', items: [], override: null }} />)
    expect(screen.getByText('Low risk')).toBeInTheDocument()
    expect(screen.queryByLabelText('Override reason')).not.toBeInTheDocument()
  })
})
