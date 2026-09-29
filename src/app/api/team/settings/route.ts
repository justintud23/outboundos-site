import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { updateTeamSettings, type UpdateTeamSettingsPatch } from '@/features/team/server/team-settings'

export async function PATCH(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  let body: { copyAdminOnReplies?: unknown; dismissOwnershipBanner?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: UpdateTeamSettingsPatch = {}
  if (body.copyAdminOnReplies !== undefined) {
    if (typeof body.copyAdminOnReplies !== 'boolean') {
      return NextResponse.json({ error: 'copyAdminOnReplies must be a boolean' }, { status: 400 })
    }
    patch.copyAdminOnReplies = body.copyAdminOnReplies
  }
  if (body.dismissOwnershipBanner !== undefined) {
    if (body.dismissOwnershipBanner !== true) {
      return NextResponse.json({ error: 'dismissOwnershipBanner must be true' }, { status: 400 })
    }
    patch.dismissOwnershipBanner = true
  }

  await updateTeamSettings(ctx.org.id, patch)
  return NextResponse.json({ ok: true })
}
