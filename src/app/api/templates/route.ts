import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { createTemplate } from '@/features/templates/server/create-template'

export async function POST(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  let body: { name?: string; promptType?: string; body?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.name || !body.promptType || !body.body) {
    return NextResponse.json({ error: 'name, promptType, and body are required' }, { status: 400 })
  }

  const validTypes = ['LEAD_SCORING', 'EMAIL_DRAFT', 'REPLY_CLASSIFICATION', 'SUBJECT_LINE']
  if (!validTypes.includes(body.promptType)) {
    return NextResponse.json({ error: `promptType must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const template = await createTemplate({
    organizationId: ctx.org.id,
    name: body.name,
    promptType: body.promptType as 'LEAD_SCORING' | 'EMAIL_DRAFT' | 'REPLY_CLASSIFICATION' | 'SUBJECT_LINE',
    body: body.body,
    notes: body.notes,
  })

  return NextResponse.json(template, { status: 201 })
}
