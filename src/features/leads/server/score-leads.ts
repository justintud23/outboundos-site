import { prisma } from '@/lib/db/prisma'
import { getAIProvider, type LeadScoreOutput } from '@/lib/ai'
import type { LeadScoreResult } from '../types'

const FALLBACK_SCORING_PROMPT = `You are a B2B sales intelligence assistant. Score each lead from 0 to 100 based on their likely fit as an ICP (Ideal Customer Profile) for an outbound sales campaign.

Consider:
- Job title seniority (VP, Director, C-level = higher score)
- Company presence (known company name = higher score)
- Email domain quality (personal domains like gmail.com = lower score)
- Completeness of profile (more fields filled = higher score)

Be consistent. Return only valid JSON.`

// Leads per OpenAI scoring request. Each lead is ~one short line
// (id/email/name/title/company ≈ 30–60 input tokens, plus a small score object
// out), so 25 fits gpt-4o's context window with wide margin even with long
// company/title strings. Small enough that a failed request loses only 25 leads;
// large enough that imports don't fan out into an excessive number of requests.
const SCORING_CHUNK_SIZE = 25

// Max scoring requests in flight at once. A large import (e.g. 2,000 leads = 80
// chunks) must NOT fire all chunks in parallel — that would burst OpenAI's
// rate limits (429s, which then back off and compound latency) and spike peak
// cost. 4 keeps throughput high while staying comfortably under typical RPM/TPM
// limits.
const SCORING_CONCURRENCY = 4

interface ScoreLeadsInput {
  organizationId: string
  leadIds: string[]
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

// Run `fn` over `items` with at most `limit` concurrent executions. Results are
// returned in input order. A simple index-cursor worker pool — no dependency.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i] as T, i)
    }
  }
  const poolSize = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: poolSize }, () => worker()))
  return results
}

function unscored(leadId: string, detail = 'no result returned'): LeadScoreOutput {
  return { leadId, score: null, reason: `AI scoring failed; lead left unscored (${detail}).` }
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
  const provider = getAIProvider()

  // Score in bounded chunks rather than one giant request: a large CSV would
  // overflow the model's context and, if it failed, lose every score. Each chunk
  // is an independent scoreLeads call (with the provider's own timeout/retries),
  // run with bounded concurrency.
  const chunks = chunk(leads, SCORING_CHUNK_SIZE)
  const chunkOutputs = await mapWithConcurrency(chunks, SCORING_CONCURRENCY, async (chunkLeads) => {
    const chunkIds = new Set(chunkLeads.map((l) => l.id))
    try {
      const out = await provider.scoreLeads(chunkLeads, prompt)
      // Only trust scores for ids actually in THIS chunk — drop hallucinated /
      // cross-chunk ids so they can't overwrite another lead's result.
      return out.filter((o) => chunkIds.has(o.leadId))
    } catch (err) {
      // Per-chunk isolation: a failed chunk degrades ONLY its own leads to
      // "unscored"; other chunks' scores are unaffected.
      console.warn('[scoreLeads] chunk failed — leaving its leads unscored', err)
      return chunkLeads.map((l) => unscored(l.id, err instanceof Error ? err.message : 'unknown error'))
    }
  })

  // Reconcile by lead id (NOT array position). The model can drop, reorder, or
  // duplicate items in its JSON; indexing by id and then resolving EACH input
  // lead guarantees exactly one result per lead and that no score is ever placed
  // on the wrong lead. Anything the model omitted becomes explicit "unscored".
  const byId = new Map<string, LeadScoreOutput>()
  for (const out of chunkOutputs.flat()) {
    byId.set(out.leadId, out)
  }

  const results: LeadScoreResult[] = []
  for (const lead of leads) {
    const resolved = byId.get(lead.id) ?? unscored(lead.id)
    try {
      await prisma.lead.update({
        where: { id: lead.id, organizationId },
        data: {
          score: resolved.score,
          scoreReason: resolved.reason,
          scoredAt: new Date(),
        },
      })
      results.push({ leadId: lead.id, score: resolved.score, reason: resolved.reason, success: true })
    } catch (err) {
      console.error('Failed to persist score for lead', lead.id, err)
      results.push({ leadId: lead.id, score: resolved.score, reason: resolved.reason, success: false })
    }
  }

  return results
}
