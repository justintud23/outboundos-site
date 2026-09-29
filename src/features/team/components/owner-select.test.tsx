// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { OwnerSelect } from './owner-select'

const members = [
  { id: 'm-1', name: 'Alice', email: 'alice@x.com', role: 'admin' },
  { id: 'm-2', name: null, email: 'bob@x.com', role: 'member' },
]

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('OwnerSelect', () => {
  it('lists Unassigned plus the members', () => {
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value={null} />)
    expect(screen.getByRole('option', { name: 'Unassigned' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'bob@x.com' })).toBeInTheDocument()
  })

  it('PATCHes the endpoint with the chosen member id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value={null} />)

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'm-1' } })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/leads/l1/owner', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: 'm-1' }),
      }),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('PATCHes null when Unassigned is chosen', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value="m-1" />)

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: '' } })

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/leads/l1/owner',
        expect.objectContaining({ body: JSON.stringify({ ownerId: null }) }),
      ),
    )
  })

  it('shows the note when given', () => {
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value={null} note="Some note text" />)
    expect(screen.getByText('Some note text')).toBeInTheDocument()
  })

  it('shows server errors in role="alert"', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Nope' }), { status: 400 }))
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value={null} />)

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'm-1' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('resets busy in finally, even when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    render(<OwnerSelect endpoint="/api/leads/l1/owner" members={members} value={null} />)

    const select = screen.getByLabelText('Owner')
    fireEvent.change(select, { target: { value: 'm-1' } })

    await waitFor(() => expect(select).not.toBeDisabled())
  })
})
