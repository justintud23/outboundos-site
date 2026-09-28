import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BusinessProfileSection } from './business-profile-section'
import { PRESETS } from '../presets'

const fetchMock = vi.fn()
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock) })
const saved = { ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 35 }] }

describe('BusinessProfileSection', () => {
  it('offers presets when there is no profile and pre-fills the form from the chosen preset', () => {
    render(<BusinessProfileSection initialProfile={null} />)
    fireEvent.click(screen.getByLabelText('Commercial snow & paving'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((screen.getByLabelText('Company summary') as HTMLTextAreaElement).value).toContain('snow')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds a yard and saves the whole profile', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ profile: saved }), { status: 200 }))
    render(<BusinessProfileSection initialProfile={{ ...PRESETS.snow_paving }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add yard' }))
    fireEvent.change(screen.getByLabelText('ZIP (yard 1)'), { target: { value: '14206' } })
    fireEvent.change(screen.getByLabelText('Radius (miles) (yard 1)'), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/settings/business-profile')
    const body = JSON.parse(init.body)
    expect(body.yards[0]).toMatchObject({ zip: '14206', radiusMiles: 35 })
    expect(body.propertyTypes.length).toBeGreaterThan(0)
    expect(await screen.findByText(/Profile saved/)).toBeInTheDocument()
  })

  it('shows a save error in an alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Yard 1: ZIP 99999 isn't a known US ZIP code" }), { status: 400 }))
    render(<BusinessProfileSection initialProfile={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('99999')
  })

  it('gives repeated yard rows unique accessible names', () => {
    const twoYards = {
      ...PRESETS.snow_paving,
      yards: [
        { label: 'Buffalo', zip: '14206', radiusMiles: 35 },
        { label: 'Rochester', zip: '14604', radiusMiles: 25 },
      ],
    }
    render(<BusinessProfileSection initialProfile={twoYards} />)
    expect((screen.getByLabelText('ZIP (yard 1)') as HTMLInputElement).value).toBe('14206')
    expect((screen.getByLabelText('ZIP (yard 2)') as HTMLInputElement).value).toBe('14604')
  })

  it('rescores in batches until nothing remains', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 200, remaining: 50, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 50, remaining: 0, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
    render(<BusinessProfileSection initialProfile={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rescore all leads' }))
    expect(await screen.findByText('All leads rescored.')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ since: '2026-10-01T00:00:00.000Z' })
  })

  it('stops the rescore loop and shows an alert when progress stalls', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 0, remaining: 10, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 0, remaining: 10, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
    render(<BusinessProfileSection initialProfile={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rescore all leads' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Rescore stopped making progress')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
