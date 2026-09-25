import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    campaign: { findFirst: vi.fn() },
    sequence: { findFirst: vi.fn() },
    mailbox: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    draft: { create: vi.fn(), update: vi.fn() },
    outboundMessage: { create: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/email', () => ({
  getEmailProvider: vi.fn(),
}))

vi.mock('@/lib/email/unsubscribe-token', () => ({
  signUnsubscribeToken: vi.fn(() => 'test-unsub-token'),
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(),
}))

vi.mock('@/features/deliverability/server/domain-health', () => ({
  getDomainHealthMap: vi.fn(),
  domainOf: (email: string) => (email.split('@')[1] ?? '').trim().toLowerCase(),
}))

vi.mock('@/features/mailboxes/server/mailbox-slots', () => ({
  startOfDay: vi.fn((d: Date) => d),
  reserveMailboxSlot: vi.fn(),
  releaseMailboxSlot: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { getAIProvider } from '@/lib/ai'
import { getDomainHealthMap } from '@/features/deliverability/server/domain-health'
import { reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { sendPlacementTest, PlacementTestError, MAX_SEEDS } from './send-placement-test'

type Fn = ReturnType<typeof vi.fn>
const mockPrisma = prisma as unknown as {
  organization: { findUnique: Fn }
  campaign: { findFirst: Fn }
  sequence: { findFirst: Fn }
  mailbox: { findFirst: Fn }
  lead: { findFirst: Fn }
  auditLog: { create: Fn }
  draft: { create: Fn; update: Fn }
  outboundMessage: { create: Fn; update: Fn }
}
const mockGetEmailProvider = getEmailProvider as unknown as Fn
const mockGetAIProvider = getAIProvider as unknown as Fn
const mockGetDomainHealthMap = getDomainHealthMap as unknown as Fn
const mockReserveMailboxSlot = reserveMailboxSlot as unknown as Fn
const mockReleaseMailboxSlot = releaseMailboxSlot as unknown as Fn

const mockSendEmail = vi.fn()
const mockPersonalize = vi.fn()

const INPUT = {
  organizationId: 'org-1',
  campaignId: 'camp-1',
  sequenceId: 'seq-1',
  mailboxId: 'mb-1',
  leadId: null as string | null,
  seeds: ['seed@tester.com'],
  clerkUserId: 'user-1',
}

const fakeOrg = {
  msTenantId: 'tenant-1',
  businessName: 'Acme Snow',
  postalAddress: '1 Main St, Buffalo, NY 14201',
  guardrailBlockedPhrases: [] as string[],
  guardrailAllowedWords: [] as string[],
}

const fakeCampaign = { id: 'camp-1', organizationId: 'org-1' }

const fakeStep = {
  id: 'step-1',
  stepNumber: 1,
  subject: 'Hi {firstName|there}',
  body: 'Hello {firstName|there}, from {company}.',
  personalizationPrompt: null as string | null,
}

const fakeSequence = {
  id: 'seq-1',
  organizationId: 'org-1',
  campaignId: 'camp-1',
  steps: [fakeStep],
}

const fakeMailbox = {
  id: 'mb-1',
  organizationId: 'org-1',
  email: 'rep@company.com',
  displayName: 'Rep',
  isActive: true,
  autoPaused: false,
  provider: 'MICROSOFT_GRAPH',
  dailyLimit: 50,
  sentToday: 0,
  lastResetAt: new Date(),
  warmupEnabled: false,
  warmupStartedAt: new Date(),
  rampPreset: 'CONSERVATIVE',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'

  mockGetEmailProvider.mockReturnValue({ sendEmail: mockSendEmail })
  mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-default' })
  mockGetAIProvider.mockReturnValue({ personalize: mockPersonalize })
  mockPersonalize.mockResolvedValue('a personalized line')

  mockPrisma.organization.findUnique.mockResolvedValue(fakeOrg)
  mockPrisma.campaign.findFirst.mockResolvedValue(fakeCampaign)
  mockPrisma.sequence.findFirst.mockResolvedValue(fakeSequence)
  mockPrisma.mailbox.findFirst.mockResolvedValue({ ...fakeMailbox })
  mockPrisma.lead.findFirst.mockResolvedValue(null)
  mockPrisma.auditLog.create.mockResolvedValue({})

  mockGetDomainHealthMap.mockResolvedValue(
    new Map([['company.com', { status: 'HEALTHY', registeredAt: new Date('2025-01-01') }]]),
  )

  mockReserveMailboxSlot.mockResolvedValue(true)
  mockReleaseMailboxSlot.mockResolvedValue(undefined)
})

describe('sendPlacementTest — seed validation', () => {
  it('trims, dedupes, and lower-cases seeds', async () => {
    await sendPlacementTest({ ...INPUT, seeds: [' Seed@Tester.com ', 'seed@tester.com', 'SEED@TESTER.COM'] })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'seed@tester.com' }))
  })

  it('rejects 0 seeds', async () => {
    const err = await sendPlacementTest({ ...INPUT, seeds: ['   ', ''] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('INVALID_SEEDS')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects more than MAX_SEEDS addresses', async () => {
    const seeds = Array.from({ length: MAX_SEEDS + 1 }, (_, i) => `seed${i}@tester.com`)
    const err = await sendPlacementTest({ ...INPUT, seeds }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('INVALID_SEEDS')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('rejects an invalid address, naming it in the message', async () => {
    const err = await sendPlacementTest({ ...INPUT, seeds: ['good@tester.com', 'not-an-email'] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('INVALID_SEEDS')
    expect((err as PlacementTestError).message).toContain('not-an-email')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — org gates', () => {
  it('throws NOT_MICROSOFT when the org has no msTenantId', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ ...fakeOrg, msTenantId: null })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('NOT_MICROSOFT')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('throws MISSING_POSTAL_ADDRESS when the org has no postal address', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ ...fakeOrg, postalAddress: '  ' })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('MISSING_POSTAL_ADDRESS')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — NOT_FOUND (org scoping)', () => {
  it('campaign not found (wrong org)', async () => {
    mockPrisma.campaign.findFirst.mockResolvedValue(null)
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('NOT_FOUND')
  })

  it('sequence not found (wrong org / campaign)', async () => {
    mockPrisma.sequence.findFirst.mockResolvedValue(null)
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('NOT_FOUND')
  })

  it('mailbox not found (wrong org)', async () => {
    mockPrisma.mailbox.findFirst.mockResolvedValue(null)
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('NOT_FOUND')
  })

  it('lead not found (wrong org) when leadId given', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null)
    const err = await sendPlacementTest({ ...INPUT, leadId: 'lead-x' }).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('NOT_FOUND')
  })
})

describe('sendPlacementTest — sequence step gate', () => {
  it('throws NO_FIRST_STEP when the sequence has no step 1', async () => {
    mockPrisma.sequence.findFirst.mockResolvedValue({ ...fakeSequence, steps: [] })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('NO_FIRST_STEP')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — mailbox gates', () => {
  it('MAILBOX_UNAVAILABLE when inactive', async () => {
    mockPrisma.mailbox.findFirst.mockResolvedValue({ ...fakeMailbox, isActive: false })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('MAILBOX_UNAVAILABLE')
  })

  it('MAILBOX_UNAVAILABLE when auto-paused', async () => {
    mockPrisma.mailbox.findFirst.mockResolvedValue({ ...fakeMailbox, autoPaused: true })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('MAILBOX_UNAVAILABLE')
  })

  it('MAILBOX_UNAVAILABLE when not a Microsoft Graph mailbox', async () => {
    mockPrisma.mailbox.findFirst.mockResolvedValue({ ...fakeMailbox, provider: 'SENDGRID' })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('MAILBOX_UNAVAILABLE')
  })

  it('DOMAIN_NOT_HEALTHY when the mailbox domain is not usable', async () => {
    mockGetDomainHealthMap.mockResolvedValue(new Map([['company.com', { status: 'UNVERIFIED', registeredAt: null }]]))
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect((err as PlacementTestError).code).toBe('DOMAIN_NOT_HEALTHY')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — guardrails', () => {
  it('GUARDRAIL_BLOCKED for an unfilled merge field with no fallback', async () => {
    mockPrisma.sequence.findFirst.mockResolvedValue({
      ...fakeSequence,
      steps: [{ ...fakeStep, body: 'Hello {missingField}, no fallback here.' }],
    })
    const err = await sendPlacementTest(INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('GUARDRAIL_BLOCKED')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — capacity', () => {
  it('NO_CAPACITY releases the partially reserved slots and sends nothing', async () => {
    mockReserveMailboxSlot
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const err = await sendPlacementTest({ ...INPUT, seeds: ['a@tester.com', 'b@tester.com'] }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('NO_CAPACITY')
    expect((err as PlacementTestError).message).toContain('rep@company.com')
    expect(mockReleaseMailboxSlot).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('a releaseMailboxSlot failure during the NO_CAPACITY rollback does not stop the error from being reported', async () => {
    mockReserveMailboxSlot.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    mockReleaseMailboxSlot.mockRejectedValueOnce(new Error('release failed'))

    const err = await sendPlacementTest({ ...INPUT, seeds: ['a@tester.com', 'b@tester.com'] }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PlacementTestError)
    expect((err as PlacementTestError).code).toBe('NO_CAPACITY')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('reserveMailboxSlot throwing mid-loop releases the slots already taken, then rethrows (nothing sent)', async () => {
    mockReserveMailboxSlot
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('DB down'))

    const err = await sendPlacementTest({ ...INPUT, seeds: ['a@tester.com', 'b@tester.com', 'c@tester.com'] }).catch(
      (e: unknown) => e,
    )

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PlacementTestError)
    expect((err as Error).message).toBe('DB down')
    expect(mockReleaseMailboxSlot).toHaveBeenCalledTimes(2)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — happy path', () => {
  it('renders merge fields for the built-in sample lead, sends one email per seed, and writes one audit row without seeds', async () => {
    const result = await sendPlacementTest({ ...INPUT, seeds: ['a@tester.com', 'b@tester.com'] })

    expect(result).toEqual({
      mailbox: 'rep@company.com',
      requested: 2,
      sent: 2,
      failed: [],
      personalizationSkipped: false,
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@tester.com',
        fromEmail: 'rep@company.com',
        fromName: 'Rep',
        subject: 'Hi Jane',
        body: 'Hello Jane, from Acme Property Group.',
        sender: { businessName: 'Acme Snow', postalAddress: '1 Main St, Buffalo, NY 14201' },
        listUnsubscribe: { url: 'https://app.test/api/unsubscribe?token=test-unsub-token' },
      }),
    )
    // No threading fields.
    const call = mockSendEmail.mock.calls[0]?.[0] as Record<string, unknown>
    expect(call.messageId).toBeUndefined()
    expect(call.inReplyTo).toBeUndefined()
    expect(call.references).toBeUndefined()
    expect(call.customArgs).toBeUndefined()

    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        actorClerkId: 'user-1',
        action: 'campaign.placement_test_sent',
        entityType: 'Campaign',
        entityId: 'camp-1',
        metadata: { mailboxId: 'mb-1', sequenceId: 'seq-1', requested: 2, sent: 2, failed: 0 },
      },
    })
    const auditMetadata = mockPrisma.auditLog.create.mock.calls[0]?.[0]?.data?.metadata as Record<string, unknown>
    expect(JSON.stringify(auditMetadata)).not.toContain('tester.com')
  })

  it('signs the unsubscribe token with leadId "placement-test", never a real lead', async () => {
    const { signUnsubscribeToken } = await import('@/lib/email/unsubscribe-token')
    await sendPlacementTest(INPUT)
    expect(signUnsubscribeToken).toHaveBeenCalledWith({ leadId: 'placement-test', organizationId: 'org-1' })
  })

  it('uses a real enrolled lead when leadId is given', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue({
      firstName: 'Bob',
      lastName: 'Builder',
      company: 'Builder Co',
      title: 'Owner',
      customFields: null,
    })
    await sendPlacementTest({ ...INPUT, leadId: 'lead-1' })
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Hi Bob' }))
    expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1' },
      select: { firstName: true, lastName: true, company: true, title: true, customFields: true },
    })
  })

  it('never creates or updates a Draft, OutboundMessage, or Lead row', async () => {
    await sendPlacementTest(INPUT)
    expect(mockPrisma.draft.create).not.toHaveBeenCalled()
    expect(mockPrisma.draft.update).not.toHaveBeenCalled()
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
    expect(mockPrisma.outboundMessage.update).not.toHaveBeenCalled()
  })
})

describe('sendPlacementTest — per-seed failures', () => {
  it('records a per-seed failure and releases its slot, continuing with the rest', async () => {
    mockSendEmail
      .mockRejectedValueOnce(new Error('Graph 503'))
      .mockResolvedValueOnce({ sgMessageId: 'sg-2' })

    const result = await sendPlacementTest({ ...INPUT, seeds: ['bad@tester.com', 'good@tester.com'] })

    expect(result.sent).toBe(1)
    expect(result.failed).toEqual([{ to: 'bad@tester.com', error: 'Graph 503' }])
    expect(mockReleaseMailboxSlot).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('a releaseMailboxSlot failure after a send error does not stop later seeds from sending', async () => {
    mockSendEmail
      .mockRejectedValueOnce(new Error('Graph 503'))
      .mockResolvedValueOnce({ sgMessageId: 'sg-2' })
    mockReleaseMailboxSlot.mockRejectedValueOnce(new Error('release failed'))

    const result = await sendPlacementTest({ ...INPUT, seeds: ['bad@tester.com', 'good@tester.com'] })

    expect(result.sent).toBe(1)
    expect(result.failed).toEqual([{ to: 'bad@tester.com', error: 'Graph 503' }])
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })
})

describe('sendPlacementTest — AI personalization', () => {
  it('inserts the AI line into the body when the step uses {personalization}', async () => {
    mockPrisma.sequence.findFirst.mockResolvedValue({
      ...fakeSequence,
      steps: [{ ...fakeStep, body: 'Hello {firstName|there}. {personalization}', personalizationPrompt: 'Mention their industry' }],
    })
    const result = await sendPlacementTest(INPUT)
    expect(mockPersonalize).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ body: 'Hello Jane. a personalized line' }))
    expect(result.personalizationSkipped).toBe(false)
  })

  it('on AI failure, inserts nothing rather than failing the whole test, and flags personalizationSkipped', async () => {
    mockPersonalize.mockRejectedValue(new Error('AI down'))
    mockPrisma.sequence.findFirst.mockResolvedValue({
      ...fakeSequence,
      steps: [{ ...fakeStep, body: 'Hello {firstName|there}. {personalization}', personalizationPrompt: 'Mention their industry' }],
    })
    const result = await sendPlacementTest(INPUT)
    expect(result.sent).toBe(1)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ body: 'Hello Jane.' }))
    expect(result.personalizationSkipped).toBe(true)
  })

  it('personalizationSkipped stays false when the step has no personalization prompt/token at all', async () => {
    const result = await sendPlacementTest(INPUT)
    expect(result.personalizationSkipped).toBe(false)
  })
})

describe('sendPlacementTest — audit log resilience', () => {
  it('an audit log write failure does not fail a completed send', async () => {
    mockPrisma.auditLog.create.mockRejectedValue(new Error('audit db down'))
    const result = await sendPlacementTest(INPUT)
    expect(result.sent).toBe(1)
    expect(result).toMatchObject({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [] })
  })
})
