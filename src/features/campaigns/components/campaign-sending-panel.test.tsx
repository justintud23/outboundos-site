// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CampaignSendingPanel } from './campaign-sending-panel'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('CampaignSendingPanel', () => {
  it('explains the sample gate and approves the sample', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ queued: 8 }), { status: 200 }))
    render(<CampaignSendingPanel campaignId="c1" autoSend sampleSize={10} sampleApprovedAt={null} sampleCount={8} msConnected hasPostalAddress />)
    expect(screen.getByText(/8 of 10 sample drafts ready/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /approve sample & start sending/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/c1/approve-sample', { method: 'POST' }))
    expect(await screen.findByText(/8 emails queued/i)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('shows live status once the sample is approved', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend sampleSize={10} sampleApprovedAt={new Date('2026-09-20')} sampleCount={10} msConnected hasPostalAddress />)
    expect(screen.getByText(/sending automatically/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve sample/i })).not.toBeInTheDocument()
  })

  it('toggles auto-send via PATCH', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'c1', autoSend: true, sampleSize: 10, sampleApprovedAt: null }), { status: 200 }))
    render(<CampaignSendingPanel campaignId="c1" autoSend={false} sampleSize={10} sampleApprovedAt={null} sampleCount={0} msConnected hasPostalAddress />)
    fireEvent.click(screen.getByRole('switch', { name: /send automatically/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/c1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ autoSend: true }) })),
    )
  })

  it('explains that queued emails are held while auto-send is off (I6)', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend={false} sampleSize={10} sampleApprovedAt={new Date('2026-09-20')} sampleCount={10} msConnected hasPostalAddress />)
    expect(screen.getByText(/queued for this campaign are held/i)).toBeInTheDocument()
  })

  it('disables the auto-send toggle with a hint until Microsoft 365 is connected (M8)', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend={false} sampleSize={10} sampleApprovedAt={null} sampleCount={0} msConnected={false} hasPostalAddress />)
    const toggle = screen.getByRole('switch', { name: /send automatically/i })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/connect microsoft 365 in/i)).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still lets auto-send be turned OFF without Microsoft 365', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend sampleSize={10} sampleApprovedAt={new Date('2026-09-20')} sampleCount={10} msConnected={false} hasPostalAddress />)
    expect(screen.getByRole('switch', { name: /send automatically/i })).not.toBeDisabled()
  })

  it('CAN-SPAM: disables turning auto-send on until a mailing address is set', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend={false} sampleSize={10} sampleApprovedAt={null} sampleCount={0} msConnected hasPostalAddress={false} />)
    const toggle = screen.getByRole('switch', { name: /send automatically/i })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/mailing address/i)).toBeInTheDocument()
  })
})
