import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: { findFirst: vi.fn(), update: vi.fn() },
    draft: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
    lead: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./check-enrollment-stop', () => ({
  checkEnrollmentStop: vi.fn(),
}))

vi.mock('./assign-mailbox', () => ({ assignEnrollmentMailbox: vi.fn() }))
// vi.hoisted: vi.mock factories are hoisted above plain consts, so the mock
// fn must be created in the hoisted scope too.
const { personalize } = vi.hoisted(() => ({ personalize: vi.fn() }))
vi.mock('@/lib/ai', () => ({ getAIProvider: () => ({ personalize }) }))

import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'
import { assignEnrollmentMailbox } from './assign-mailbox'
import { runSequenceStep } from './run-sequence-step'

const mockEnrollmentFind = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>
const mockCheckStop = checkEnrollmentStop as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enroll-1',
    organizationId: 'org-1',
    sequenceId: 'seq-1',
    leadId: 'lead-1',
    currentStepNumber: 0,
    status: 'ACTIVE',
    startedAt: new Date(),
    mailboxId: null,
    failedAttempts: 0,
    sequence: {
      campaignId: 'camp-1',
      campaign: { id: 'camp-1', autoSend: false, sampleSize: 10, sampleApprovedAt: null },
      steps: [
        { id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0, personalizationPrompt: null },
        { id: 'step-2', stepNumber: 2, subject: 'Follow up', body: 'Just checking', delayDays: 3, personalizationPrompt: null },
      ],
    },
    lead: { id: 'lead-1', status: 'NEW', email: 'jane@acmepm.com', phone: null, country: null, firstName: 'Jane', lastName: null, company: 'Acme', title: null, customFields: null, emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date() },
    organization: { sendingPaused: false, guardrailBlockedPhrases: [], guardrailAllowedWords: [], allowCanadianRecipients: false, blockRiskyEmails: false },
    ...overrides,
  }
}

// tx fake capturing draft.create and outboundMessage.create
function txFake() {
  const draftCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'draft-1', ...data }))
  const messageCreate = vi.fn().mockResolvedValue({ id: 'msg-1' })
  const enrollmentUpdate = vi.fn().mockResolvedValue({})
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      draft: { findFirst: vi.fn().mockResolvedValue(null), create: draftCreate, groupBy: vi.fn().mockResolvedValue([]) },
      sequenceStep: { findUnique: vi.fn().mockResolvedValue({ winningVariantId: null, winningVariant: null, subjectVariants: [] }) },
      sequenceEnrollment: { update: enrollmentUpdate },
      outboundMessage: { create: messageCreate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }),
  )
  return { draftCreate, messageCreate, enrollmentUpdate }
}

const autoCampaign = (sampleApprovedAt: Date | null) => ({
  campaignId: 'camp-1',
  campaign: { id: 'camp-1', autoSend: true, sampleSize: 2, sampleApprovedAt },
  steps: [{ id: 'step-1', stepNumber: 1, subject: 'Snow plan for {company}', body: 'Hi {firstName|there},\n\n{personalization}\n\nWe plow lots.', delayDays: 0, personalizationPrompt: 'Mention their company.' }],
})

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runSequenceStep', () => {
  it('returns STOPPED if stop conditions are met', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: true, reason: 'reply_received' })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('STOPPED')
  })

  it('returns COMPLETED if no more steps', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 2 }))
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('COMPLETED')
  })

  it('returns DRAFT_GENERATED on successful step execution', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'draft-1' }),
          groupBy: vi.fn().mockResolvedValue([]),
        },
        sequenceStep: { findUnique: vi.fn().mockResolvedValue({ winningVariantId: null, winningVariant: null, subjectVariants: [] }) },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('DRAFT_GENERATED')
  })

  it('assigns a subject variant on the FIRST step when a test exists', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    const draftCreate = vi.fn().mockResolvedValue({ id: 'draft-1' })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: draftCreate,
          groupBy: vi.fn().mockResolvedValue([]), // both arms at 0 → oldest wins
        },
        sequenceStep: {
          findUnique: vi.fn().mockResolvedValue({
            winningVariantId: null,
            winningVariant: null,
            subjectVariants: [
              { id: 'v1', subject: 'Variant A subject' },
              { id: 'v2', subject: 'Variant B subject' },
            ],
          }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('DRAFT_GENERATED')
    const data = draftCreate.mock.calls[0][0].data
    expect(data.subject).toBe('Variant A subject') // the draft's subject reflects the assigned variant
    expect(data.subjectVariantId).toBe('v1')
  })

  it('does NOT assign a variant on a follow-up step (step 2 threads, not tested)', async () => {
    // currentStepNumber 1 → next step is step 2 (a follow-up).
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 1 }))
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    const draftCreate = vi.fn().mockResolvedValue({ id: 'draft-2' })
    const stepFind = vi.fn()
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: draftCreate,
          groupBy: vi.fn().mockResolvedValue([]),
        },
        sequenceStep: { findUnique: stepFind },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('DRAFT_GENERATED')
    // Variant selection is never consulted for a follow-up step.
    expect(stepFind).not.toHaveBeenCalled()
    const data = draftCreate.mock.calls[0][0].data
    expect(data.subject).toBe('Follow up') // the step's own subject, unchanged
    expect(data.subjectVariantId).toBeUndefined()
  })

  it('returns SKIPPED if draft already exists for step', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-draft' }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('SKIPPED')
  })
})

describe('runSequenceStep — auto-send pipeline', () => {
  beforeEach(() => {
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    ;(assignEnrollmentMailbox as ReturnType<typeof vi.fn>).mockResolvedValue('mb-1')
    personalize.mockResolvedValue('Saw Acme runs several plazas.')
  })

  it('manual campaign: renders merge fields into a PENDING_REVIEW draft, no queueing', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({
      sequence: { ...makeEnrollment().sequence, steps: [{ id: 'step-1', stepNumber: 1, subject: 'Hi {firstName}', body: 'For {company}', delayDays: 0, personalizationPrompt: null }] },
    }))
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DRAFT_GENERATED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({ subject: 'Hi Jane', body: 'For Acme', status: 'PENDING_REVIEW', isSample: false })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(personalize).not.toHaveBeenCalled()
  })

  it('auto-send before sample approval: personalized sample draft, mailbox assigned, not queued', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(null) }))
    ;(prisma.draft.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DRAFT_GENERATED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({
      subject: 'Snow plan for Acme',
      body: 'Hi Jane,\n\nSaw Acme runs several plazas.\n\nWe plow lots.',
      status: 'PENDING_REVIEW',
      isSample: true,
    })
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('auto-send with a full sample batch: defers without generating or calling AI', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(null) }))
    ;(prisma.draft.count as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(personalize).not.toHaveBeenCalled()
    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith({ where: { id: 'enroll-1' }, data: { nextDueAt: expect.any(Date) } })
  })

  it('auto-send after sample approval: APPROVED draft queued on the assigned mailbox', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()) }))
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('QUEUED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', isSample: false })
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({ mailboxId: 'mb-1', status: 'QUEUED', draftId: 'draft-1' })
  })

  it('missing first name with no fallback → BLOCKED, never queued (Review Focus #2)', async () => {
    const seq = autoCampaign(new Date())
    seq.steps[0].body = 'Hi {firstName},\n\n{personalization}'
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: seq, lead: { ...makeEnrollment().lead, firstName: null } }))
    const { draftCreate, messageCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate.mock.calls[0][0].data.status).toBe('BLOCKED')
    expect(draftCreate.mock.calls[0][0].data.guardrailFlags).toContainEqual({ rule: 'UNFILLED_TOKEN', match: '{firstName}' })
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('AI failure below the limit: defers and counts the failure', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()), failedAttempts: 0 }))
    personalize.mockRejectedValue(new Error('timeout'))
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enroll-1' },
      data: { failedAttempts: 1, nextDueAt: expect.any(Date) },
    })
  })

  it('AI failure at the limit: BLOCKED draft flagged AI_FAILED', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()), failedAttempts: 2 }))
    personalize.mockRejectedValue(new Error('timeout'))
    const { draftCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate.mock.calls[0][0].data.status).toBe('BLOCKED')
    expect(draftCreate.mock.calls[0][0].data.guardrailFlags[0].rule).toBe('AI_FAILED')
  })

  it('org sending paused: auto-send campaign defers', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({
      sequence: autoCampaign(new Date()),
      organization: { sendingPaused: true, guardrailBlockedPhrases: [], guardrailAllowedWords: [], allowCanadianRecipients: false },
    }))
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
  })

  it('no usable mailbox: defers', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()) }))
    ;(assignEnrollmentMailbox as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
  })

  describe('auto-send follow-up ordering (step N waits for step N-1 to be SENT + delay)', () => {
    const DAY = 24 * 60 * 60 * 1000
    const twoStepAuto = () => ({
      campaignId: 'camp-1',
      campaign: { id: 'camp-1', autoSend: true, sampleSize: 2, sampleApprovedAt: new Date('2026-09-01') },
      steps: [
        { id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0, personalizationPrompt: null },
        { id: 'step-2', stepNumber: 2, subject: 'Follow up', body: 'Just checking', delayDays: 3, personalizationPrompt: null },
      ],
    })
    const atStep1 = () => makeEnrollment({ sequence: twoStepAuto(), currentStepNumber: 1, mailboxId: 'mb-1' })
    const mockDraftFind = () => prisma.draft.findFirst as ReturnType<typeof vi.fn>
    const deferredUntil = () => {
      const call = (prisma.sequenceEnrollment.update as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { data: { nextDueAt: Date } }
      return call.data.nextDueAt.getTime()
    }

    beforeEach(() => mockCheckStop.mockResolvedValue({ shouldStop: false }))

    it('step 1 BLOCKED → DEFERRED ~1h, no step-2 draft', async () => {
      mockEnrollmentFind.mockResolvedValue(atStep1())
      mockDraftFind().mockResolvedValue({ status: 'BLOCKED', outboundMessages: [] })
      const { draftCreate } = txFake()
      const before = Date.now()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
      expect(draftCreate).not.toHaveBeenCalled()
      expect(mockDraftFind()).toHaveBeenCalledWith({
        where: { sequenceId: 'seq-1', leadId: 'lead-1', sequenceStepId: 'step-1' },
        select: { status: true, outboundMessages: { select: { sentAt: true }, take: 1 } },
      })
      expect(deferredUntil() - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 50)
      expect(deferredUntil() - before).toBeLessThan(2 * 60 * 60 * 1000)
    })

    it('step 1 still QUEUED (not sent) → DEFERRED, no draft', async () => {
      mockEnrollmentFind.mockResolvedValue(atStep1())
      mockDraftFind().mockResolvedValue({ status: 'APPROVED', outboundMessages: [{ sentAt: null }] })
      const { draftCreate } = txFake()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
      expect(draftCreate).not.toHaveBeenCalled()
      expect(personalize).not.toHaveBeenCalled()
    })

    it('step 1 SENT 1 day ago with a 3-day delay → DEFERRED until sentAt + 3 days', async () => {
      const sentAt = new Date(Date.now() - DAY)
      mockEnrollmentFind.mockResolvedValue(atStep1())
      mockDraftFind().mockResolvedValue({ status: 'APPROVED', outboundMessages: [{ sentAt }] })
      const { draftCreate } = txFake()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
      expect(draftCreate).not.toHaveBeenCalled()
      expect(Math.abs(deferredUntil() - (sentAt.getTime() + 3 * DAY))).toBeLessThan(1000)
    })

    it('step 1 SENT longer ago than the delay → step 2 generated and queued', async () => {
      mockEnrollmentFind.mockResolvedValue(atStep1())
      mockDraftFind().mockResolvedValue({ status: 'APPROVED', outboundMessages: [{ sentAt: new Date(Date.now() - 4 * DAY) }] })
      const { draftCreate, messageCreate } = txFake()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('QUEUED')
      expect(draftCreate.mock.calls[0][0].data).toMatchObject({ sequenceStepId: 'step-2', status: 'APPROVED' })
      expect(messageCreate).toHaveBeenCalledTimes(1)
    })

    it('step 1 REJECTED (skipped by a human) → step 2 proceeds as a new thread', async () => {
      mockEnrollmentFind.mockResolvedValue(atStep1())
      mockDraftFind().mockResolvedValue({ status: 'REJECTED', outboundMessages: [] })
      const { draftCreate } = txFake()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('QUEUED')
      expect(draftCreate).toHaveBeenCalledTimes(1)
    })

    it('manual (non-auto-send) campaigns are not gated', async () => {
      mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 1 }))
      const { draftCreate } = txFake()
      expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DRAFT_GENERATED')
      expect(draftCreate).toHaveBeenCalledTimes(1)
      expect(mockDraftFind()).not.toHaveBeenCalled()
    })
  })
})

describe('runSequenceStep — CASL', () => {
  it('stops the enrollment of a Canadian lead without generating a draft', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, customFields: { province: 'ON' } } }))
    const update = vi.fn().mockResolvedValue({})
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ sequenceEnrollment: { update } }))
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('STOPPED')
    expect(update.mock.calls[0][0].data).toMatchObject({ status: 'STOPPED', stoppedReason: 'excluded_canada: province is Ontario' })
    expect(mockCheckStop).not.toHaveBeenCalled()
  })
})

describe('runSequenceStep — email verification gate (first step only)', () => {
  const mockLeadUpdateMany = prisma.lead.updateMany as ReturnType<typeof vi.fn>
  const mockEnrollmentUpdate = prisma.sequenceEnrollment.update as ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.MILLIONVERIFIER_API_KEY = 'test-key'
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockEnrollmentUpdate.mockResolvedValue({})
    mockLeadUpdateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

  it('defers step 1 by 10 minutes while the lead is PENDING, without drafting', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'PENDING', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    const before = Date.now()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    const next = (mockEnrollmentUpdate.mock.calls[0]![0] as { data: { nextDueAt: Date } }).data.nextDueAt.getTime()
    expect(next - before).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(next - before).toBeLessThan(11 * 60 * 1000)
    expect(draftCreate).not.toHaveBeenCalled()
    expect(personalize).not.toHaveBeenCalled()
  })

  it('queues an UNCHECKED lead (enrolled before verification existed) and waits (Review Focus #2)', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null } }))
    txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', emailCheck: { not: 'PENDING' } },
      data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
    })
  })

  it('stops the enrollment on an INVALID address', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'INVALID', emailCheckResult: 'invalid' } }))
    const { draftCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('STOPPED')
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: 'enroll-1' },
      data: expect.objectContaining({ status: 'STOPPED', stoppedReason: 'Email failed verification (invalid)', processing: false }),
    })
    expect(draftCreate).not.toHaveBeenCalled()
  })

  it('stops a RISKY address when the org blocks risky emails', async () => {
    const e = makeEnrollment()
    mockEnrollmentFind.mockResolvedValue({ ...e, lead: { ...e.lead, emailCheck: 'RISKY', emailCheckResult: 'catch_all' }, organization: { ...e.organization, blockRiskyEmails: true } })
    txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('STOPPED')
  })

  it('does not gate follow-up steps', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 1, lead: { ...makeEnrollment().lead, emailCheck: 'PENDING', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).not.toBe('DEFERRED')
    expect(draftCreate).toHaveBeenCalled()
  })

  it('is a no-op when verification is not configured', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'UNCHECKED', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate).toHaveBeenCalled()
  })
})
