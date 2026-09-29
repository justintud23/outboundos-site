import { prisma } from '@/lib/db/prisma'
import type { SenderFields } from '../sender-fields'

export async function getCampaignSender(organizationId: string, campaignId: string): Promise<SenderFields> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { owner: { select: { senderFirstName: true, senderLastName: true } } },
  })
  const owner = campaign?.owner
  if (!owner) return { senderFirstName: null, senderName: null }
  // No Clerk-name fallback: when the sender names are empty, callers fall back
  // to their own template default rather than signing with the Clerk name.
  const first = owner.senderFirstName?.trim() || null
  const full = [owner.senderFirstName?.trim(), owner.senderLastName?.trim()].filter(Boolean).join(' ') || null
  return { senderFirstName: first, senderName: full }
}
