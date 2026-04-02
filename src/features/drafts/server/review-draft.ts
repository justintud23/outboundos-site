import { prisma } from '@/lib/db/prisma'
import type { DraftDTO } from '../types'
import { DraftNotFoundError, DraftNotPendingError } from '../types'

interface ReviewDraftInput {
  organizationId: string
  draftId: string
  clerkUserId: string
  action: 'approve' | 'reject'
  subject?: string
  body?: string
  rejectionReason?: string
}

export async function reviewDraft({
  organizationId,
  draftId,
  clerkUserId,
  action,
  subject,
  body,
  rejectionReason,
}: ReviewDraftInput): Promise<DraftDTO> {
  // Fetch draft — org-scoped (returns null for both not-found and wrong-org to avoid enumeration)
  const existing = await prisma.draft.findFirst({
    where: { id: draftId, organizationId },
  })

  if (!existing) {
    throw new DraftNotFoundError()
  }

  const updated = await prisma.$transaction(async (tx) => {
    const now = new Date()

    if (action === 'approve') {
      const result = await tx.draft.updateMany({
        where: {
          id: draftId,
          organizationId,
          status: 'PENDING_REVIEW',
        },
        data: {
          status: 'APPROVED',
          ...(subject !== undefined && { subject }),
          ...(body !== undefined && { body }),
          approvedByClerkId: clerkUserId,
          approvedAt: now,
        },
      })

      if (result.count === 0) {
        throw new DraftNotPendingError(existing.status)
      }
    } else {
      const result = await tx.draft.updateMany({
        where: {
          id: draftId,
          organizationId,
          status: 'PENDING_REVIEW',
        },
        data: {
          status: 'REJECTED',
          rejectedAt: now,
          ...(rejectionReason !== undefined && { rejectionReason }),
        },
      })

      if (result.count === 0) {
        throw new DraftNotPendingError(existing.status)
      }
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: action === 'approve' ? 'draft.approved' : 'draft.rejected',
        entityType: 'Draft',
        entityId: draftId,
        metadata:
          action === 'approve'
            ? { leadId: existing.leadId, edited: subject !== undefined || body !== undefined }
            : { leadId: existing.leadId, rejectionReason: rejectionReason ?? null },
      },
    })

    return tx.draft.findUnique({ where: { id: draftId } })
  })

  if (!updated) {
    throw new Error(`Draft ${draftId} not found after update`)
  }

  return {
    id: updated.id,
    organizationId: updated.organizationId,
    leadId: updated.leadId,
    subject: updated.subject,
    body: updated.body,
    status: updated.status,
    promptTemplateId: updated.promptTemplateId,
    createdByClerkId: updated.createdByClerkId,
    approvedByClerkId: updated.approvedByClerkId,
    approvedAt: updated.approvedAt,
    rejectedAt: updated.rejectedAt,
    rejectionReason: updated.rejectionReason,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}
