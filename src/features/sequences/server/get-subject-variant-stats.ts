import { prisma } from '@/lib/db/prisma'
import type { SubjectVariantStatDTO, SubjectVariantTestDTO } from '../types'

interface GetStatsInput {
  organizationId: string
  sequenceStepId: string
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

/**
 * Per-variant A/B test results for one sequence step, DERIVED entirely from the
 * existing event pipeline — never from denormalized counters:
 *   - sent    = OutboundMessages actually sent (sentAt set) carrying the variant
 *   - opened  = distinct sent messages with ≥1 OPENED MessageEvent
 *   - replied = distinct sent messages with ≥1 InboundReply
 * Open/reply RATES are reported, but raw sent/opened/replied counts are always
 * returned too so the UI can stay honest about small samples (e.g. show "1/1",
 * never a confident-looking "100%"). No statistical-significance claim is made.
 *
 * Returns null if the step does not exist / is not in the org. Archived variants
 * are included so historical results survive a variant's removal.
 */
export async function getSubjectVariantStats({
  organizationId,
  sequenceStepId,
}: GetStatsInput): Promise<SubjectVariantTestDTO | null> {
  const step = await prisma.sequenceStep.findFirst({
    where: { id: sequenceStepId, sequence: { organizationId } },
    select: {
      id: true,
      winningVariantId: true,
      subjectVariants: {
        select: { id: true, subject: true, isArchived: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!step) return null

  const variants = step.subjectVariants
  const activeCount = variants.filter((v) => !v.isArchived).length

  if (variants.length === 0) {
    return {
      sequenceStepId: step.id,
      hasTest: false,
      winningVariantId: step.winningVariantId,
      variants: [],
    }
  }

  const ids = variants.map((v) => v.id)

  // sent: grouped directly by the variant key on the message.
  // opened / replied: grouped by message, then mapped back to a variant — each
  // message counts once even with multiple opens/replies (distinct-message rate),
  // mirroring how get-campaign-performance derives its open/reply numbers.
  const [sentRows, openedRows, repliedRows] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['subjectVariantId'],
      where: { organizationId, subjectVariantId: { in: ids }, sentAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: {
        organizationId,
        eventType: 'OPENED',
        outboundMessage: { subjectVariantId: { in: ids } },
      },
      _count: { _all: true },
    }),
    prisma.inboundReply.groupBy({
      by: ['outboundMessageId'],
      where: { organizationId, outboundMessage: { subjectVariantId: { in: ids } } },
      _count: { _all: true },
    }),
  ])

  // Resolve the message → variant mapping for the opened/replied rows in one read.
  const eventMsgIds = [
    ...new Set([
      ...openedRows.map((r) => r.outboundMessageId),
      ...repliedRows
        .map((r) => r.outboundMessageId)
        .filter((id): id is string => id !== null),
    ]),
  ]
  const msgs = eventMsgIds.length
    ? await prisma.outboundMessage.findMany({
        where: { id: { in: eventMsgIds } },
        select: { id: true, subjectVariantId: true },
      })
    : []
  const msgToVariant = new Map(msgs.map((m) => [m.id, m.subjectVariantId]))

  const sentByVariant = new Map<string, number>(
    sentRows.map((r) => [r.subjectVariantId as string, r._count._all]),
  )
  const openedByVariant = new Map<string, number>()
  for (const r of openedRows) {
    const vId = msgToVariant.get(r.outboundMessageId)
    if (vId) openedByVariant.set(vId, (openedByVariant.get(vId) ?? 0) + 1)
  }
  const repliedByVariant = new Map<string, number>()
  for (const r of repliedRows) {
    if (r.outboundMessageId === null) continue
    const vId = msgToVariant.get(r.outboundMessageId)
    if (vId) repliedByVariant.set(vId, (repliedByVariant.get(vId) ?? 0) + 1)
  }

  const variantStats: SubjectVariantStatDTO[] = variants.map((v) => {
    const sent = sentByVariant.get(v.id) ?? 0
    const opened = openedByVariant.get(v.id) ?? 0
    const replied = repliedByVariant.get(v.id) ?? 0
    return {
      id: v.id,
      subject: v.subject,
      isArchived: v.isArchived,
      isWinner: step.winningVariantId === v.id,
      sent,
      opened,
      replied,
      openRate: rate(opened, sent),
      replyRate: rate(replied, sent),
    }
  })

  return {
    sequenceStepId: step.id,
    // A "test" exists once there are 2+ active arms, or a winner has been chosen.
    hasTest: activeCount >= 2 || step.winningVariantId !== null,
    winningVariantId: step.winningVariantId,
    variants: variantStats,
  }
}
