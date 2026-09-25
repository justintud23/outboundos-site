import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createSequence } from '@/features/sequences/server/create-sequence'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { ContentHighRiskError } from '@/features/content-check/types'

export async function POST(request: Request) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { campaignId?: string; name?: string; steps?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.campaignId || !body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json({ error: 'campaignId, name, and at least one step are required' }, { status: 400 })
  }

  const org = await resolveOrganization(orgId)

  try {
    const sequence = await createSequence({
      organizationId: org.id,
      campaignId: body.campaignId,
      name: body.name,
      steps: body.steps as { stepNumber: number; subject: string; body: string; delayDays: number; personalizationPrompt?: string | null }[],
    })
    return NextResponse.json(sequence, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ContentHighRiskError) {
      return NextResponse.json({ code: 'CONTENT_HIGH_RISK', error: err.message, findings: err.items }, { status: 422 })
    }
    throw err
  }
}
