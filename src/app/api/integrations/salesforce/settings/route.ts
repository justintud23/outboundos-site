import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { updateSalesforceSettings } from '@/features/salesforce/server/settings'

const PatchSchema = z
  .object({
    customerAccountTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    blockOpenOpportunities: z.boolean().optional(),
    logActivity: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required.' })

export async function PATCH(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const ok = await updateSalesforceSettings(ctx.org.id, parsed.data)
  if (!ok) {
    return NextResponse.json({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
