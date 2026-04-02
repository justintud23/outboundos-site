import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { DraftDTO } from '../types'
import { PendingDraftExistsError, LeadNotFoundError } from '../types'

const FALLBACK_DRAFT_PROMPT = `You are a personalized outbound sales email writer. Write a short, direct cold email for the lead provided. Be conversational and focus on value. Keep it under 150 words. Return only valid JSON.`

interface GenerateDraftInput {
  organizationId: string
  leadId: string
  clerkUserId: string
}

export async function generateDraft({
  organizationId,
  leadId,
  clerkUserId,
}: GenerateDraftInput): Promise<DraftDTO> {
  // Fetch lead — org-scoped; 404 if missing
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
    },
  })

  if (!lead) {
    throw new LeadNotFoundError()
  }

  // Fetch active EMAIL_DRAFT template; null = use fallback
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType: 'EMAIL_DRAFT', isActive: true },
  })

  const promptTemplateId = template?.id ?? null
  const prompt = template?.body ?? FALLBACK_DRAFT_PROMPT

  // AI call OUTSIDE the transaction to avoid long-running transactions
  const provider = getAIProvider()
  const aiResult = await provider.draftEmail(lead, prompt)

  // Transaction: check for duplicate PENDING_REVIEW draft, then create
  const draft = await prisma.$transaction(async (tx) => {
    const existing = await tx.draft.findFirst({
      where: { leadId, organizationId, status: 'PENDING_REVIEW' },
    })

    if (existing) {
      throw new PendingDraftExistsError(existing.id)
    }

    const created = await tx.draft.create({
      data: {
        organizationId,
        leadId,
        subject: aiResult.subject,
        body: aiResult.body,
        status: 'PENDING_REVIEW',
        promptTemplateId,
        createdByClerkId: clerkUserId,
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'draft.generated',
        entityType: 'Draft',
        entityId: created.id,
        metadata: { leadId, promptTemplateId },
      },
    })

    return created
  })

  return {
    id: draft.id,
    organizationId: draft.organizationId,
    leadId: draft.leadId,
    subject: draft.subject,
    body: draft.body,
    status: draft.status,
    promptTemplateId: draft.promptTemplateId,
    createdByClerkId: draft.createdByClerkId,
    approvedByClerkId: draft.approvedByClerkId,
    approvedAt: draft.approvedAt,
    rejectedAt: draft.rejectedAt,
    rejectionReason: draft.rejectionReason,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }
}
