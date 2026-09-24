import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import type { EmailVerifier } from '../provider'
import { checkFromResult, MAX_VERIFY_ATTEMPTS } from '../gate'
import { getVerifier } from './get-verifier'

export const VERIFY_BUDGET_MS = 10_000
export const VERIFY_CONCURRENCY = 5
const BATCH = 50

export interface VerifyRunResult {
  checked: number
  retried: number
  accountError: 'no_credits' | 'bad_key' | null
  skipped: boolean
}

interface Deps {
  verifier?: EmailVerifier | null
  now?: () => number
}

const PAUSED_REASON = {
  no_credits: 'out of MillionVerifier credits',
  bad_key: 'the MillionVerifier API key was rejected',
} as const

/**
 * Resolve PENDING leads, oldest first, within a time budget. Every write is
 * conditional on the lead still being PENDING, so a bounce that marks it
 * INVALID mid-check is never overwritten.
 */
export async function verifyPendingLeads(budgetMs = VERIFY_BUDGET_MS, deps: Deps = {}): Promise<VerifyRunResult> {
  const verifier = deps.verifier === undefined ? getVerifier() : deps.verifier
  const clock = deps.now ?? Date.now
  const result: VerifyRunResult = { checked: 0, retried: 0, accountError: null, skipped: false }
  if (!verifier) return { ...result, skipped: true }

  const startedAt = clock()
  const leads = await prisma.lead.findMany({
    where: { emailCheck: 'PENDING' },
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
    select: { id: true, organizationId: true, email: true, emailCheckAttempts: true },
  })

  const succeededOrgs = new Set<string>()
  let next = 0

  async function worker(v: EmailVerifier) {
    while (next < leads.length && !result.accountError && clock() - startedAt < budgetMs) {
      const lead = leads[next++]!
      const outcome = await v.verify(lead.email)
      if (outcome.kind === 'account') {
        result.accountError ??= outcome.reason
        return
      }
      const where = { id: lead.id, emailCheck: 'PENDING' as const }
      if (outcome.kind === 'result') {
        await prisma.lead.updateMany({
          where,
          data: {
            emailCheck: checkFromResult(outcome.result),
            emailCheckResult: outcome.result,
            emailCheckedAt: new Date(clock()),
            emailCheckAttempts: 0,
          },
        })
        result.checked++
        succeededOrgs.add(lead.organizationId)
        continue
      }
      const attempts = lead.emailCheckAttempts + 1
      await prisma.lead.updateMany({
        where,
        data:
          attempts >= MAX_VERIFY_ATTEMPTS
            ? { emailCheck: 'RISKY', emailCheckResult: 'unknown', emailCheckedAt: new Date(clock()), emailCheckAttempts: attempts }
            : { emailCheckAttempts: attempts },
      })
      result.retried++
    }
  }

  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, leads.length) }, () => worker(verifier)))

  if (succeededOrgs.size > 0) {
    await prisma.organization.updateMany({
      where: { id: { in: [...succeededOrgs] }, verificationAlertedAt: { not: null } },
      data: { verificationAlertedAt: null, verificationPausedReason: null },
    })
  }
  if (result.accountError) await alertPaused(result.accountError, new Date(clock()))
  return result
}

// One alert per org per outage: claim verificationAlertedAt atomically, and
// release it if the email couldn't be sent so the next run retries.
async function alertPaused(reason: 'no_credits' | 'bad_key', now: Date): Promise<void> {
  const orgs = await prisma.lead.findMany({
    where: { emailCheck: 'PENDING' },
    distinct: ['organizationId'],
    select: { organizationId: true },
  })
  for (const { organizationId } of orgs) {
    const claim = await prisma.organization.updateMany({
      where: { id: organizationId, verificationAlertedAt: null },
      data: { verificationAlertedAt: now, verificationPausedReason: PAUSED_REASON[reason] },
    })
    if (claim.count !== 1) continue
    const ok = await sendOrgAlert(
      organizationId,
      `Email verification paused: ${PAUSED_REASON[reason]}`,
      `New leads' first emails are waiting until their addresses can be verified. ${
        reason === 'no_credits'
          ? 'Add MillionVerifier credits'
          : 'Check MILLIONVERIFIER_API_KEY in the Vercel project settings'
      }; verification resumes automatically on the next run. Nothing is sent to unverified addresses in the meantime.`,
    )
    if (!ok) await prisma.organization.update({ where: { id: organizationId }, data: { verificationAlertedAt: null } })
  }
}
