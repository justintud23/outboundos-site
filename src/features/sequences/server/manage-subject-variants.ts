import { prisma } from '@/lib/db/prisma'
import type { SubjectVariantDTO } from '../types'
import {
  SubjectVariantStepNotFoundError,
  SubjectVariantNotFirstStepError,
  SubjectVariantNotFoundError,
} from '../types'

function toDTO(v: { id: string; subject: string; isArchived: boolean }): SubjectVariantDTO {
  return { id: v.id, subject: v.subject, isArchived: v.isArchived }
}

async function resolveOrgStep(organizationId: string, sequenceStepId: string) {
  const step = await prisma.sequenceStep.findFirst({
    where: { id: sequenceStepId, sequence: { organizationId } },
    select: { id: true, stepNumber: true, sequence: { select: { organizationId: true } } },
  })
  if (!step) throw new SubjectVariantStepNotFoundError(sequenceStepId)
  return step
}

/**
 * Add a subject-line variant (one A/B arm) to the FIRST step of a sequence.
 * Variants only apply to the first email — follow-ups thread as "Re: <root>" —
 * so adding one to any later step is rejected.
 */
export async function createSubjectVariant({
  organizationId,
  sequenceStepId,
  subject,
}: {
  organizationId: string
  sequenceStepId: string
  subject: string
}): Promise<SubjectVariantDTO> {
  const step = await resolveOrgStep(organizationId, sequenceStepId)
  if (step.stepNumber !== 1) throw new SubjectVariantNotFirstStepError(sequenceStepId)

  const created = await prisma.subjectVariant.create({
    data: { organizationId, sequenceStepId, subject },
    select: { id: true, subject: true, isArchived: true },
  })
  return toDTO(created)
}

/** Edit a variant's subject text (org-scoped). */
export async function updateSubjectVariant({
  organizationId,
  variantId,
  subject,
}: {
  organizationId: string
  variantId: string
  subject: string
}): Promise<SubjectVariantDTO> {
  const result = await prisma.subjectVariant.updateMany({
    where: { id: variantId, organizationId },
    data: { subject },
  })
  if (result.count === 0) throw new SubjectVariantNotFoundError(variantId)

  const updated = await prisma.subjectVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { id: true, subject: true, isArchived: true },
  })
  return toDTO(updated)
}

/**
 * Soft-delete (archive) a variant. We never hard-delete: in-flight and historical
 * sends keep their attribution and the variant's past stats stay visible. An
 * archived variant is no longer assigned to new sends. If it was the winner, the
 * winner pointer is cleared (re-opening assignment to the remaining active arms).
 */
export async function archiveSubjectVariant({
  organizationId,
  variantId,
}: {
  organizationId: string
  variantId: string
}): Promise<void> {
  const variant = await prisma.subjectVariant.findFirst({
    where: { id: variantId, organizationId },
    select: { id: true, sequenceStepId: true },
  })
  if (!variant) throw new SubjectVariantNotFoundError(variantId)

  await prisma.$transaction([
    prisma.subjectVariant.update({ where: { id: variantId }, data: { isArchived: true } }),
    prisma.sequenceStep.updateMany({
      where: { id: variant.sequenceStepId, winningVariantId: variantId },
      data: { winningVariantId: null },
    }),
  ])
}

/**
 * Manually pick the winning variant for a step. This is the ONLY thing "pick
 * winner" does — no statistical claim, no auto-routing:
 *   - From now on, only the winner is assigned to NEW first-step drafts; the
 *     losing variants stop being assigned (selectSubjectVariant returns the winner).
 *   - Already queued/sent drafts and messages are UNTOUCHED.
 *   - All variants' historical stats remain visible.
 * Pass variantId = null to clear the winner and resume the split.
 */
export async function pickSubjectVariantWinner({
  organizationId,
  sequenceStepId,
  variantId,
}: {
  organizationId: string
  sequenceStepId: string
  variantId: string | null
}): Promise<void> {
  await resolveOrgStep(organizationId, sequenceStepId)

  if (variantId !== null) {
    const variant = await prisma.subjectVariant.findFirst({
      where: { id: variantId, organizationId, sequenceStepId },
      select: { id: true },
    })
    if (!variant) throw new SubjectVariantNotFoundError(variantId)
  }

  await prisma.sequenceStep.update({
    where: { id: sequenceStepId },
    data: { winningVariantId: variantId },
  })
}
