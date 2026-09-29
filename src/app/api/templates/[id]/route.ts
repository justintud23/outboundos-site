import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { updateTemplate } from '@/features/templates/server/update-template'
import { setActiveTemplate } from '@/features/templates/server/set-active-template'
import { duplicateTemplate } from '@/features/templates/server/duplicate-template'
import { TemplateNotFoundError } from '@/features/templates/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const { id } = await params

  let body: { name?: string; body?: string; notes?: string | null; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (body.action === 'activate') {
      const template = await setActiveTemplate({ organizationId: ctx.org.id, templateId: id })
      return NextResponse.json(template)
    }

    if (body.action === 'duplicate') {
      const template = await duplicateTemplate({ organizationId: ctx.org.id, templateId: id })
      return NextResponse.json(template, { status: 201 })
    }

    const template = await updateTemplate({
      organizationId: ctx.org.id,
      templateId: id,
      name: body.name,
      body: body.body,
      notes: body.notes,
    })
    return NextResponse.json(template)
  } catch (err) {
    if (err instanceof TemplateNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
