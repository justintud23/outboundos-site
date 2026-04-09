import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { updateTemplate } from '@/features/templates/server/update-template'
import { setActiveTemplate } from '@/features/templates/server/set-active-template'
import { TemplateNotFoundError } from '@/features/templates/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await resolveOrganization(orgId)

  let body: { name?: string; body?: string; notes?: string | null; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    if (body.action === 'activate') {
      const template = await setActiveTemplate({ organizationId: org.id, templateId: id })
      return NextResponse.json(template)
    }

    const template = await updateTemplate({
      organizationId: org.id,
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
