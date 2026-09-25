// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CreateSequenceForm } from './create-sequence-form'

const campaigns = [{ id: 'camp-1', name: 'Winter Lots' }]

beforeEach(() => {
  vi.resetAllMocks()
})

describe('CreateSequenceForm — live content risk', () => {
  it('scores each step as you type', () => {
    render(<CreateSequenceForm campaigns={campaigns} onCreated={vi.fn()} />)
    const subject = screen.getAllByPlaceholderText(/subject/i)[0]!
    const body = screen.getAllByPlaceholderText('Email body')[0]!
    fireEvent.change(body, { target: { value: 'Hi {firstName|there}, we plow and salt commercial lots across Buffalo every winter. Would a quote for next season be useful for your properties this year?' } })
    fireEvent.change(subject, { target: { value: 'Snow plan' } })
    expect(screen.getByText('Low risk')).toBeInTheDocument()
    fireEvent.change(subject, { target: { value: 'Re: snow plan' } })
    expect(screen.getByText('High risk')).toBeInTheDocument()
  })

  it('uses the org blocked phrases', () => {
    render(<CreateSequenceForm campaigns={campaigns} onCreated={vi.fn()} blockedPhrases={['winter promo']} />)
    fireEvent.change(screen.getAllByPlaceholderText('Email body')[0]!, { target: { value: 'Ask about our winter promo for commercial lots, plowing and salting across Buffalo this season.' } })
    expect(screen.getByText('High risk')).toBeInTheDocument()
  })

  it('shows a 422 CONTENT_HIGH_RISK message from the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'CONTENT_HIGH_RISK', error: 'High spam risk in New — step 1.' }), { status: 422 })))
    render(<CreateSequenceForm campaigns={campaigns} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/sequence name/i), { target: { value: 'New' } })
    fireEvent.change(screen.getAllByPlaceholderText(/subject/i)[0]!, { target: { value: 'Re: hi' } })
    fireEvent.change(screen.getAllByPlaceholderText('Email body')[0]!, { target: { value: 'Hello there' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText('High spam risk in New — step 1.')).toBeInTheDocument()
  })
})
