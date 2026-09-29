import { prisma } from '@/lib/db/prisma'
import { chunk, soqlString, type SfClient } from './client'

const CACHE_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; byMemberId: Map<string, string> }>()

async function load(client: SfClient, organizationId: string): Promise<Map<string, string>> {
  const hit = cache.get(organizationId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.byMemberId
  const members = await prisma.orgMember.findMany({
    where: { organizationId, email: { not: null } },
    select: { id: true, email: true },
  })
  const emails = [...new Set(members.map((m) => (m.email ?? '').toLowerCase()).filter(Boolean))]
  const userByEmail = new Map<string, string>()
  for (const part of chunk(emails, 200)) {
    const users = await client.query<{ Id: string; Email: string }>(
      `SELECT Id, Email FROM User WHERE IsActive = true AND Email IN (${part.map(soqlString).join(', ')})`,
    )
    for (const u of users) userByEmail.set(u.Email.toLowerCase(), u.Id)
  }
  const byMemberId = new Map<string, string>()
  for (const m of members) {
    const id = userByEmail.get((m.email ?? '').toLowerCase())
    if (id) byMemberId.set(m.id, id)
  }
  cache.set(organizationId, { at: Date.now(), byMemberId })
  return byMemberId
}

/** The Salesforce User to own records for this rep; falls back to the connected user. */
export async function resolveSfUserId(
  client: SfClient,
  organizationId: string,
  ownerMemberId: string | null,
): Promise<string> {
  const conn = await prisma.salesforceConnection.findUnique({ where: { organizationId }, select: { sfUserId: true } })
  const fallback = conn?.sfUserId ?? ''
  if (!ownerMemberId) return fallback
  const map = await load(client, organizationId)
  return map.get(ownerMemberId) ?? fallback
}

export function clearOwnerMatchCache(): void {
  cache.clear()
}
