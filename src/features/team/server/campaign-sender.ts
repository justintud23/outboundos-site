import { prisma } from '@/lib/db/prisma'
import type { SenderFields } from '../sender-fields'

export async function getCampaignSender(organizationId: string, campaignId: string): Promise<SenderFields> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { owner: { select: { senderFirstName: true, senderLastName: true, name: true } } },
  })
  const owner = campaign?.owner
  if (!owner) return { senderFirstName: null, senderName: null }
  const first = owner.senderFirstName?.trim() || owner.name?.trim().split(/\s+/)[0] || null
  const full = [owner.senderFirstName?.trim(), owner.senderLastName?.trim()].filter(Boolean).join(' ') || owner.name?.trim() || null
  return { senderFirstName: first, senderName: full }
}
