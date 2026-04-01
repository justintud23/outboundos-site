import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { LeadScoreResult } from '../types'

const FALLBACK_SCORING_PROMPT = `You are a B2B sales intelligence assistant. Score each lead from 0 to 100 based on their likely fit as an ICP (Ideal Customer Profile) for an outbound sales campaign.

Consider:
- Job title seniority (VP, Director, C-level = higher score)
- Company presence (known company name = higher score)
- Email domain quality (personal domains like gmail.com = lower score)
- Completeness of profile (more fields filled = higher score)

Be consistent. Return only valid JSON.`

interface ScoreLeadsInput {
  organizationId: string
  leadIds: string[]
}

export async function scoreLeads({
  organizationId,
  leadIds,
}: ScoreLeadsInput): Promise<LeadScoreResult[]> {
  // Fetch leads — always org-scoped
  const leads = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      organizationId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
    },
  })

  if (leads.length === 0) return []

  // Fetch active prompt template (fall back to built-in if none configured)
  const template = await prisma.promptTemplate.findFirst({
    where: {
      organizationId,
      promptType: 'LEAD_SCORING',
      isActive: true,
    },
  })

  const prompt = template?.body ?? FALLBACK_SCORING_PROMPT

  // Score via AI provider
  const provider = getAIProvider()
  const scores = await provider.scoreLeads(leads, prompt)

  // Persist each score
  const results: LeadScoreResult[] = []

  for (const score of scores) {
    try {
      await prisma.lead.update({
        where: { id: score.leadId, organizationId },
        data: {
          score: score.score,
          scoreReason: score.reason,
          scoredAt: new Date(),
        },
      })
      results.push({ ...score, success: true })
    } catch (err) {
      results.push({
        leadId: score.leadId,
        score: score.score,
        reason: score.reason,
        success: false,
      })
    }
  }

  return results
}
