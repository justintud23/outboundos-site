import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { requireActiveConnection, salesforceErrorResponse } from '@/features/salesforce/server/require-connection'
import { importListView } from '@/features/salesforce/server/import-list-view'
import { scoreLeads } from '@/features/leads/server/score-leads'

export const maxDuration = 60

const ImportBodySchema = z.object({
  object: z.enum(['Lead', 'Contact']),
  listViewId: z.string().min(1),
  listViewLabel: z.string().min(1).max(200),
  useSalesforceOwners: z.boolean().optional(),
})

export async function POST(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = ImportBodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { object, listViewId, listViewLabel } = parsed.data
  // Only an admin may pull Salesforce record owners onto imported leads.
  const useSalesforceOwners = ctx.isAdmin ? (parsed.data.useSalesforceOwners ?? false) : false

  const conn = await requireActiveConnection(ctx.org.id)
  if (conn instanceof NextResponse) return conn

  let result: Awaited<ReturnType<typeof importListView>>
  try {
    result = await importListView({
      organizationId: ctx.org.id,
      memberId: ctx.member.id,
      object,
      listViewId,
      listViewLabel,
      useSalesforceOwners,
    })
  } catch (err) {
    const mapped = salesforceErrorResponse(err)
    if (mapped) return mapped
    console.error('[POST /api/salesforce/import]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Scoring never undoes the import — mirrors src/app/api/leads/import/route.ts.
  let scoreResults: Awaited<ReturnType<typeof scoreLeads>> = []
  if (result.leadIds.length > 0) {
    try {
      scoreResults = await scoreLeads({ organizationId: ctx.org.id, leadIds: result.leadIds })
    } catch (err) {
      console.error('Scoring failed after Salesforce import:', err)
      return NextResponse.json(
        { ...result, scoringError: 'Scoring failed — leads were imported but not yet scored.' },
        { status: 201 },
      )
    }
  }

  const allUnscored = scoreResults.length > 0 && scoreResults.every((r) => r.score === null)
  if (allUnscored) {
    return NextResponse.json(
      { ...result, scores: scoreResults, scoringError: 'Scoring failed — leads were imported but not yet scored.' },
      { status: 201 },
    )
  }

  return NextResponse.json({ ...result, scores: scoreResults }, { status: 201 })
}
