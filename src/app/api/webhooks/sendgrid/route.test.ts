import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/features/events/server/ingest-webhook-events', () => ({
  ingestWebhookEvents: vi.fn(),
}))

vi.mock('@/features/events/server/verify-sendgrid-signature', async (importOriginal) => {
  // Keep the real header-name constants; stub only the verification function.
  const actual = await importOriginal<typeof import('@/features/events/server/verify-sendgrid-signature')>()
  return { ...actual, verifySendGridSignature: vi.fn() }
})

import { ingestWebhookEvents } from '@/features/events/server/ingest-webhook-events'
import {
  verifySendGridSignature,
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
} from '@/features/events/server/verify-sendgrid-signature'
import { POST } from './route'

const mockIngest = ingestWebhookEvents as ReturnType<typeof vi.fn>
const mockVerify = verifySendGridSignature as ReturnType<typeof vi.fn>

const validBody = [{ event: 'delivered', sg_event_id: 'evt-1', draftId: 'draft-1' }]

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/sendgrid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/webhooks/sendgrid', () => {
  it('ingests events when the signature is valid', async () => {
    mockVerify.mockReturnValue('valid')
    mockIngest.mockResolvedValue({ processed: 1, skipped: 0 })

    const res = await POST(
      makeRequest(validBody, {
        [SENDGRID_SIGNATURE_HEADER]: 'sig',
        [SENDGRID_TIMESTAMP_HEADER]: '1700000000',
      }),
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true, processed: 1, skipped: 0 })
    expect(mockIngest).toHaveBeenCalledWith(validBody)

    // Verification ran against the RAW body + the signature/timestamp headers.
    expect(mockVerify).toHaveBeenCalledWith(JSON.stringify(validBody), 'sig', '1700000000')
  })

  it('returns 401 and does not ingest when the signature is invalid', async () => {
    mockVerify.mockReturnValue('invalid')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await POST(
      makeRequest(validBody, { [SENDGRID_SIGNATURE_HEADER]: 'bad-sig' }),
    )

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Invalid signature' })
    expect(mockIngest).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('falls through with a warning when the verification key is unconfigured outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockVerify.mockReturnValue('unconfigured')
    mockIngest.mockResolvedValue({ processed: 1, skipped: 0 })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(200)
    expect(mockIngest).toHaveBeenCalledWith(validBody)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('SENDGRID_WEBHOOK_VERIFICATION_KEY is unset'),
    )

    warnSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('returns 503 and does not ingest when the verification key is unconfigured in production (fail closed)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mockVerify.mockReturnValue('unconfigured')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest(validBody))

    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json).toEqual({ error: 'Webhook verification not configured' })
    expect(mockIngest).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('SENDGRID_WEBHOOK_VERIFICATION_KEY is unset in production'),
    )

    errorSpy.mockRestore()
    vi.unstubAllEnvs()
  })

  it('returns 200 without ingesting on malformed-but-authentic JSON (no SendGrid retries)', async () => {
    mockVerify.mockReturnValue('valid')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await POST(makeRequest('{ not json', { [SENDGRID_SIGNATURE_HEADER]: 'sig' }))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ ok: true })
    expect(mockIngest).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('returns 200 without ingesting when an authentic payload is not an array', async () => {
    mockVerify.mockReturnValue('valid')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await POST(makeRequest({ not: 'an array' }, { [SENDGRID_SIGNATURE_HEADER]: 'sig' }))

    expect(res.status).toBe(200)
    expect(mockIngest).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })
})
