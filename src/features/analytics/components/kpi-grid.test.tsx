// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiGrid } from './kpi-grid'
import type { AnalyticsDTO } from '../types'

const baseAnalytics: AnalyticsDTO = {
  sent: 100,
  delivered: 90,
  opened: 45,
  clicked: 10,
  replies: 8,
  positiveReplies: 5,
  bounced: 3,
  unsubscribes: 2,
}

const zeroAnalytics: AnalyticsDTO = {
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replies: 0,
  positiveReplies: 0,
  bounced: 0,
  unsubscribes: 0,
}

describe('KpiGrid', () => {
  it('renders all 8 KPI labels', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    expect(screen.getByText('Sent')).toBeDefined()
    expect(screen.getByText('Delivered')).toBeDefined()
    expect(screen.getByText('Opened')).toBeDefined()
    expect(screen.getByText('Clicked')).toBeDefined()
    expect(screen.getByText('Replies')).toBeDefined()
    expect(screen.getByText('Positive Replies')).toBeDefined()
    expect(screen.getByText('Bounced')).toBeDefined()
    expect(screen.getByText('Unsubscribes')).toBeDefined()
  })

  it('renders the sent and delivered metric values', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    expect(screen.getByText('100')).toBeDefined()
    expect(screen.getByText('90')).toBeDefined()
  })

  it('shows no rate text when sent is zero (avoids division by zero)', () => {
    render(<KpiGrid analytics={zeroAnalytics} />)
    const rateTexts = screen.queryAllByText(/rate/)
    expect(rateTexts).toHaveLength(0)
  })

  it('shows correct open rate as a percentage', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    // opened=45, sent=100 → 45.0% rate
    expect(screen.getByText('45.0% rate')).toBeDefined()
  })

  it('shows correct positive reply rate as a percentage', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    // positiveReplies=5, replies=8 → 62.5% rate
    expect(screen.getByText('62.5% rate')).toBeDefined()
  })
})
