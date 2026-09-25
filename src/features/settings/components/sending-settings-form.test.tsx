// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SendingSettingsForm } from './sending-settings-form'
import type { SendingSettingsDTO } from '@/features/settings/server/sending-settings'

const initial: SendingSettingsDTO = {
  timezone: 'America/New_York',
  businessHoursStart: 8,
  businessHoursEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
  escalationEmail: 'alerts@acme.com',
  sendingPaused: false,
  pausedReason: null,
  guardrailBlockedPhrases: [],
  guardrailAllowedWords: [],
  businessName: 'Acme Snow',
  postalAddress: '1 Main St, Buffalo, NY 14201',
  allowCanadianRecipients: false,
  blockRiskyEmails: false,
  msConnected: false,
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('SendingSettingsForm', () => {
  it('renders the initial escalation email', () => {
    render(<SendingSettingsForm initial={initial} />)
    expect(screen.getByDisplayValue('alerts@acme.com')).toBeDefined()
  })

  it('clicking "Pause all sending" PATCHes sendingPaused and shows "Resume sending"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...initial, sendingPaused: true, pausedReason: 'Paused manually from Settings.' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SendingSettingsForm initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: /pause all sending/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /resume sending/i })).toBeDefined())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/sending',
      expect.objectContaining({
        method: 'PATCH',
        body: '{"sendingPaused":true}',
      }),
    )
  })

  it('shows the server error text on a 400 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid escalation email' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<SendingSettingsForm initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.getByText('Invalid escalation email')).toBeDefined())
  })

  it('warns that sending is blocked when there is no mailing address', () => {
    render(<SendingSettingsForm initial={{ ...initial, postalAddress: null }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/sending is blocked/i)
  })

  it('saves business name, mailing address and the Canada switch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initial, allowCanadianRecipients: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SendingSettingsForm initial={initial} />)
    fireEvent.change(screen.getByLabelText(/mailing address/i), { target: { value: 'PO Box 9\nBuffalo, NY 14201' } })
    fireEvent.click(screen.getByLabelText(/allow canadian recipients/i))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ businessName: 'Acme Snow', postalAddress: 'PO Box 9\nBuffalo, NY 14201', allowCanadianRecipients: true })
  })

  it('saves the block-risky-emails toggle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initial, blockRiskyEmails: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SendingSettingsForm initial={initial} />)
    fireEvent.click(screen.getByLabelText(/Block risky emails/))
    fireEvent.click(screen.getByRole('button', { name: /^save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ blockRiskyEmails: true })
  })
})
