import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { decryptToken } from '@/lib/crypto/token-cipher'
import { revokeToken } from '@/features/salesforce/server/oauth'
import { getConnection, deleteConnection } from '@/features/salesforce/server/connection'

export async function DELETE() {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const conn = await getConnection(ctx.org.id)
  if (conn) {
    try {
      await revokeToken(conn.loginHost, decryptToken(conn.refreshTokenEnc))
    } catch (err) {
      console.error('[salesforce disconnect] revoke failed', err)
    }
  }
  await deleteConnection(ctx.org.id)

  return NextResponse.json({ ok: true })
}
