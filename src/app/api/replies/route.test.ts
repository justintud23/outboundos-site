import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

vi.mock('@/features/replies/server/ingest-reply', () => ({
  ingestReply: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { ingestReply } from '@/features/replies/server/ingest-reply'
import { LeadNotFoundByEmailError } from '@/features/replies/types'
import { POST } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockIngestReply = ingestReply as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id' }
const fakeDTO = {
  id: 'reply-1',
  organizationId: 'internal-org-id',
  leadId: 'lead-1',
  outboundMessageId: null,
  rawBody: 'Sounds great!',
  classification: 'POSITIVE',
  classificationConfidence: 0.92,
  receivedAt: new Date('2026-01-15T10:00:00Z'),
  createdAt: new Date('2026-01-15T10:00:01Z'),
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/replies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/replies', () => {
  it('returns 403 when orgId or userId is missing', async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: null })

    const req = makeRequest({ fromEmail: 'a@b.com', rawBody: 'hi' })
    const res = await POST(req)

    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json).toHaveProperty('error')
  })

  it('returns 201 with InboundReplyDTO on success', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
    mockIngestReply.mockResolvedValue(fakeDTO)

    const req = makeRequest({
      fromEmail: 'lead@acme.com',
      rawBody: 'Sounds great!',
      inReplyToSgMessageId: 'sg-abc',
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.id).toBe('reply-1')
    expect(json.classification).toBe('POSITIVE')
    expect(mockResolveOrganization).toHaveBeenCalledWith('clerk-org-id')
    expect(mockIngestReply).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'internal-org-id',
        fromEmail: 'lead@acme.com',
        rawBody: 'Sounds great!',
        inReplyToSgMessageId: 'sg-abc',
      }),
    )
  })

  it('returns 404 on LeadNotFoundByEmailError', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
    mockIngestReply.mockRejectedValue(new LeadNotFoundByEmailError('unknown@example.com'))

    const req = makeRequest({ fromEmail: 'unknown@example.com', rawBody: 'hi' })
    const res = await POST(req)

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json).toEqual({ error: 'Lead not found' })
  })

  it('returns 500 and calls console.error on unexpected error', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
    mockIngestReply.mockRejectedValue(new Error('Something exploded'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = makeRequest({ fromEmail: 'lead@acme.com', rawBody: 'hi' })
    const res = await POST(req)

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toHaveProperty('error')
    expect(consoleSpy).toHaveBeenCalledWith('[POST /api/replies]', expect.any(Error))

    consoleSpy.mockRestore()
  })

  it('returns 400 when fromEmail is missing', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })

    const req = makeRequest({ rawBody: 'hi' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ error: 'fromEmail and rawBody are required' })
    expect(mockResolveOrganization).not.toHaveBeenCalled()
  })

  it('returns 400 when receivedAt is not a valid date string', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })

    const req = makeRequest({ fromEmail: 'lead@acme.com', rawBody: 'hi', receivedAt: 'not-a-date' })
    const res = await POST(req)

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toEqual({ error: 'receivedAt must be a valid ISO 8601 date string' })
    expect(mockResolveOrganization).not.toHaveBeenCalled()
  })

  it('parses receivedAt ISO string to Date before passing to ingestReply', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id', userId: 'user-1' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
    mockIngestReply.mockResolvedValue(fakeDTO)

    const isoString = '2026-01-15T10:00:00.000Z'
    const req = makeRequest({
      fromEmail: 'lead@acme.com',
      rawBody: 'OOO reply',
      receivedAt: isoString,
    })
    const res = await POST(req)

    expect(res.status).toBe(201)
    expect(mockIngestReply).toHaveBeenCalledWith(
      expect.objectContaining({
        receivedAt: new Date(isoString),
      }),
    )
  })
})
