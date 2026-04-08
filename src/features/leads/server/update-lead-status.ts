import type { LeadStatus } from '@prisma/client'
import { transitionLeadStatus } from './transition-lead-status'
import type { TransitionResult } from '../types'

interface UpdateLeadStatusInput {
  organizationId: string
  leadId: string
  newStatus: LeadStatus
  actorClerkId: string
}

export async function updateLeadStatus({
  organizationId,
  leadId,
  newStatus,
  actorClerkId,
}: UpdateLeadStatusInput): Promise<TransitionResult> {
  return transitionLeadStatus({
    organizationId,
    leadId,
    newStatus,
    trigger: 'manual:user',
    actorClerkId,
    metadata: { source: 'pipeline_board' },
  })
}
