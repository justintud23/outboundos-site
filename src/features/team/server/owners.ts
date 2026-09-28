import { prisma } from '@/lib/db/prisma'

/**
 * Owner lookups used by write routes to decide `canAct`. Each is scoped to
 * the caller's org and returns:
 *   - the OrgMember id, when the entity (or its owning campaign/lead) has one
 *   - `null` when the entity exists but is unassigned
 *   - `undefined` when the entity doesn't exist in this org (route 404s)
 */

export async function getCampaignOwnerId(orgId: string, campaignId: string): Promise<string | null | undefined> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: orgId },
    select: { ownerId: true },
  })
  return campaign?.ownerId
}

export async function getSequenceOwnerId(orgId: string, sequenceId: string): Promise<string | null | undefined> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId: orgId },
    select: { campaign: { select: { ownerId: true } } },
  })
  return sequence?.campaign.ownerId
}

export async function getStepOwnerId(orgId: string, stepId: string): Promise<string | null | undefined> {
  const step = await prisma.sequenceStep.findFirst({
    where: { id: stepId, sequence: { organizationId: orgId } },
    select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
  })
  return step?.sequence.campaign.ownerId
}

export async function getVariantOwnerId(orgId: string, variantId: string): Promise<string | null | undefined> {
  const variant = await prisma.subjectVariant.findFirst({
    where: { id: variantId, organizationId: orgId },
    select: { sequenceStep: { select: { sequence: { select: { campaign: { select: { ownerId: true } } } } } } },
  })
  return variant?.sequenceStep.sequence.campaign.ownerId
}

export async function getEnrollmentOwnerId(orgId: string, enrollmentId: string): Promise<string | null | undefined> {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: orgId },
    select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
  })
  return enrollment?.sequence.campaign.ownerId
}

export async function getDraftOwnerId(orgId: string, draftId: string): Promise<string | null | undefined> {
  const draft = await prisma.draft.findFirst({
    where: { id: draftId, organizationId: orgId },
    select: { campaign: { select: { ownerId: true } }, lead: { select: { ownerId: true } } },
  })
  if (!draft) return undefined
  return draft.campaign ? draft.campaign.ownerId : draft.lead.ownerId
}

export async function getLeadOwnerId(orgId: string, leadId: string): Promise<string | null | undefined> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: orgId },
    select: { ownerId: true },
  })
  return lead?.ownerId
}

export async function getMessageOwnerId(orgId: string, messageId: string): Promise<string | null | undefined> {
  const message = await prisma.outboundMessage.findFirst({
    where: { id: messageId, organizationId: orgId },
    select: { lead: { select: { ownerId: true } } },
  })
  return message?.lead.ownerId
}
