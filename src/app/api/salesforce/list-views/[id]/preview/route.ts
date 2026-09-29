import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { requireActiveConnection, salesforceErrorResponse } from '@/features/salesforce/server/require-connection'
import { previewListView, type SfObjectName } from '@/features/salesforce/server/import-list-view'

function isSfObject(v: string | null): v is SfObjectName {
  return v === 'Lead' || v === 'Contact'
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const object = new URL(request.url).searchParams.get('object')
  if (!isSfObject(object)) {
    return NextResponse.json({ error: 'object must be Lead or Contact' }, { status: 400 })
  }

  const conn = await requireActiveConnection(ctx.org.id)
  if (conn instanceof NextResponse) return conn

  const { id } = await params

  try {
    const preview = await previewListView({ organizationId: ctx.org.id, object, listViewId: id })
    return NextResponse.json(preview)
  } catch (err) {
    const mapped = salesforceErrorResponse(err)
    if (mapped) return mapped
    console.error('[GET /api/salesforce/list-views/[id]/preview]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
