import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { evaluateItems, stepItems, variantItem, type ContentItem } from '../campaign-content'
import { ContentHighRiskError, ContentOverrideValidationError, type ContentStatusDTO } from '../types'

export interface LoadedContent {
  campaignId: string
  autoSend: boolean
  items: ContentItem[]
  blockedPhrases: string[]
  allowedWords: string[]
  override: { reason: string; by: string | null; at: Date | null; hash: string } | null
}

/** SHA-256 over the campaign's content in a stable (key-sorted) order. */
export function contentHash(items: ContentItem[]): string {
  const canonical = [...items]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((i) => [i.key, i.subject, i.body])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export async function loadCampaignContent(organizationId: string, campaignId: string): Promise<LoadedContent | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      id: true,
      autoSend: true,
      contentOverrideHash: true,
      contentOverrideReason: true,
      contentOverrideBy: true,
      contentOverrideAt: true,
      organization: { select: { guardrailBlockedPhrases: true, guardrailAllowedWords: true } },
      sequences: {
        select: {
          id: true,
          name: true,
          steps: {
            orderBy: { stepNumber: 'asc' },
            select: {
              id: true,
              stepNumber: true,
              subject: true,
              body: true,
              subjectVariants: { where: { isArchived: false }, select: { id: true, subject: true } },
            },
          },
        },
      },
    },
  })
  if (!campaign) return null

  const items: ContentItem[] = []
  for (const seq of campaign.sequences) {
    items.push(...stepItems(seq.id, seq.name, seq.steps))
    const first = seq.steps.find((s) => s.stepNumber === 1)
    if (first) for (const v of first.subjectVariants) items.push(variantItem(seq.id, seq.name, v.id, v.subject, first.body))
  }

  return {
    campaignId: campaign.id,
    autoSend: campaign.autoSend,
    items,
    blockedPhrases: campaign.organization.guardrailBlockedPhrases,
    allowedWords: campaign.organization.guardrailAllowedWords,
    override:
      campaign.contentOverrideHash && campaign.contentOverrideReason
        ? { reason: campaign.contentOverrideReason, by: campaign.contentOverrideBy, at: campaign.contentOverrideAt, hash: campaign.contentOverrideHash }
        : null,
  }
}

/**
 * Refuse HIGH-risk content on a campaign that is (or is about to start)
 * auto-sending, unless a recorded override matches the exact content.
 * `apply` returns the content as it will be after the pending write.
 * A missing campaign is the caller's 404 to raise, not ours.
 */
export async function assertContentAllowed(input: {
  organizationId: string
  campaignId: string
  apply?: (items: ContentItem[]) => ContentItem[]
  enablingAutoSend?: boolean
}): Promise<void> {
  const loaded = await loadCampaignContent(input.organizationId, input.campaignId)
  if (!loaded) return
  if (!loaded.autoSend && !input.enablingAutoSend) return
  const items = input.apply ? input.apply(loaded.items) : loaded.items
  const evaluation = evaluateItems(items, loaded.blockedPhrases, loaded.allowedWords)
  if (evaluation.level !== 'HIGH') return
  if (loaded.override && loaded.override.hash === contentHash(items)) return
  throw new ContentHighRiskError(evaluation.items.filter((i) => i.level === 'HIGH'))
}

export async function getCampaignContentStatus(organizationId: string, campaignId: string): Promise<ContentStatusDTO | null> {
  const loaded = await loadCampaignContent(organizationId, campaignId)
  if (!loaded) return null
  const evaluation = evaluateItems(loaded.items, loaded.blockedPhrases, loaded.allowedWords)
  return {
    level: evaluation.level,
    items: evaluation.items,
    override: loaded.override
      ? { reason: loaded.override.reason, by: loaded.override.by, at: loaded.override.at ? loaded.override.at.toISOString() : null, valid: loaded.override.hash === contentHash(loaded.items) }
      : null,
  }
}

export async function recordContentOverride(input: {
  organizationId: string
  campaignId: string
  clerkUserId: string
  reason: string
}): Promise<ContentStatusDTO | null> {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 500) {
    throw new ContentOverrideValidationError('Give a reason of 10–500 characters.')
  }
  const loaded = await loadCampaignContent(input.organizationId, input.campaignId)
  if (!loaded) return null
  await prisma.campaign.update({
    where: { id: loaded.campaignId },
    data: {
      contentOverrideReason: reason,
      contentOverrideBy: input.clerkUserId,
      contentOverrideAt: new Date(),
      contentOverrideHash: contentHash(loaded.items),
    },
  })
  return getCampaignContentStatus(input.organizationId, input.campaignId)
}
