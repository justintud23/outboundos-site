import { describe, it, expect, vi } from 'vitest'
import { fetchRegistrationDate } from './rdap'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('fetchRegistrationDate', () => {
  it('reads the registration event', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { events: [{ eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2026-09-01T12:00:00Z' }] }))
    expect((await fetchRegistrationDate('Acme.com', f))?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
    expect(f.mock.calls[0][0]).toBe('https://rdap.org/domain/acme.com')
  })
  it.each([
    ['non-200', json(404, {})],
    ['no registration event', json(200, { events: [] })],
    ['bad date', json(200, { events: [{ eventAction: 'registration', eventDate: 'nope' }] })],
  ])('%s → null', async (_n, res) => {
    expect(await fetchRegistrationDate('acme.com', vi.fn().mockResolvedValue(res))).toBeNull()
  })
  it('network failure → null', async () => {
    expect(await fetchRegistrationDate('acme.com', vi.fn().mockRejectedValue(new Error('down')))).toBeNull()
  })
})
