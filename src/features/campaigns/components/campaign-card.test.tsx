// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampaignCard } from './campaign-card'
import type { CampaignSummaryDTO } from '@/features/campaigns/server/get-campaigns'

const baseCampaign: CampaignSummaryDTO = {
  id:                 'c1',
  name:               'Q2 Outreach Blitz',
  description:        'Cold outreach to SaaS founders',
  status:             'ACTIVE',
  createdAt:          new Date('2026-01-15'),
  messageCount:       42,
  draftPendingCount:  3,
  draftApprovedCount: 7,
  replyCount:         8,
}

describe('CampaignCard', () => {
  it('renders the campaign name', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText('Q2 Outreach Blitz')).toBeDefined()
  })

  it('renders the status badge', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText('Active')).toBeDefined()
  })

  it('renders the description when present', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText('Cold outreach to SaaS founders')).toBeDefined()
  })

  it('does not render description when absent', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, description: null }} />)
    expect(screen.queryByText('Cold outreach to SaaS founders')).toBeNull()
  })

  it('renders message count, total drafts, and reply count', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText('42')).toBeDefined()
    expect(screen.getByText('10')).toBeDefined() // 3 pending + 7 approved
    expect(screen.getByText('8')).toBeDefined()
  })

  it('shows pending draft indicator when draftPendingCount > 0', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText('(3 pending)')).toBeDefined()
  })

  it('does not show pending indicator when no pending drafts', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, draftPendingCount: 0 }} />)
    expect(screen.queryByText(/pending/)).toBeNull()
  })

  it('renders the created date', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    expect(screen.getByText(/Created Jan \d+, 2026/)).toBeDefined()
  })

  it('renders a link to /drafts', () => {
    render(<CampaignCard campaign={baseCampaign} />)
    const link = screen.getByRole('link', { name: /view drafts/i })
    expect(link).toBeDefined()
  })
})
