import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ScoreBreakdownTable } from './score-breakdown'

const breakdown = {
  parts: [
    { signal: 'area', label: 'In area (10 mi)', points: 30 },
    { signal: 'property', label: 'HOA / community association (great fit)', points: 25 },
    { signal: 'title', label: 'Junior title', points: -10 },
    { signal: 'size', label: 'Size unknown', points: 0 },
  ],
  rulesScore: 45,
  cap: null,
  aiAdjustment: 5,
  aiReason: 'Strong fit signals in the customFields blob',
}

const cappedBreakdown = {
  parts: [
    { signal: 'area', label: 'Out of area (40 mi)', points: 0 },
    { signal: 'property', label: 'HOA / community association (great fit)', points: 25 },
  ],
  rulesScore: 15,
  cap: 15,
  aiAdjustment: null,
  aiReason: null,
}

describe('ScoreBreakdownTable', () => {
  it('renders every part with signed points', () => {
    render(<ScoreBreakdownTable breakdown={breakdown} />)
    expect(screen.getByText('In area (10 mi)')).toBeInTheDocument()
    expect(screen.getByText('+30')).toBeInTheDocument()
    expect(screen.getByText('HOA / community association (great fit)')).toBeInTheDocument()
    expect(screen.getByText('+25')).toBeInTheDocument()
    expect(screen.getByText('Junior title')).toBeInTheDocument()
    expect(screen.getByText('-10')).toBeInTheDocument()
    expect(screen.getByText('Size unknown')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('has an accessible caption', () => {
    render(<ScoreBreakdownTable breakdown={breakdown} />)
    expect(screen.getByText('How this score was calculated')).toBeInTheDocument()
  })

  it('shows the cap note naming the capping part', () => {
    const { container } = render(<ScoreBreakdownTable breakdown={cappedBreakdown} />)
    expect(screen.getByText(/Capped at/)).toBeInTheDocument()
    expect(container.textContent).toContain('Capped at 15: Out of area (40 mi)')
  })

  it('shows no cap note when cap is null', () => {
    render(<ScoreBreakdownTable breakdown={breakdown} />)
    expect(screen.queryByText(/Capped at/)).not.toBeInTheDocument()
  })

  it('renders nothing for null', () => {
    const { container } = render(<ScoreBreakdownTable breakdown={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for an empty object (legacy lead with no breakdown)', () => {
    const { container } = render(<ScoreBreakdownTable breakdown={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for malformed JSON shapes without crashing', () => {
    const { container: c1 } = render(<ScoreBreakdownTable breakdown="not an object" />)
    expect(c1).toBeEmptyDOMElement()

    const { container: c2 } = render(<ScoreBreakdownTable breakdown={{ parts: 'nope' }} />)
    expect(c2).toBeEmptyDOMElement()

    const { container: c3 } = render(<ScoreBreakdownTable breakdown={{ parts: [{ label: 'x' }] }} />)
    expect(c3).toBeEmptyDOMElement()

    const { container: c4 } = render(<ScoreBreakdownTable breakdown={undefined} />)
    expect(c4).toBeEmptyDOMElement()
  })
})
