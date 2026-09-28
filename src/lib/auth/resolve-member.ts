import { auth, clerkClient } from '@clerk/nextjs/server'
import { Prisma } from '@prisma/client'
import type { Organization, OrgMember } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from './resolve-organization'

export interface MemberContext { org: Organization; member: OrgMember; isAdmin: boolean }

const REFRESH_MS = 60 * 60 * 1000

/**
 * The signed-in member of the active org, created on first sight and kept in
 * sync with Clerk (role every request; name/email at most hourly). Background
 * jobs read OrgMember rows directly and never call this.
 */
export async function resolveMember(): Promise<MemberContext | null> {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null
  const org = await resolveOrganization(orgId)
  const role = orgRole === 'org:admin' ? 'admin' : 'member'

  let member = await prisma.orgMember.findUnique({
    where: { clerkUserId_organizationId: { clerkUserId: userId, organizationId: org.id } },
  })
  if (!member) {
    member = await createMember(userId, org.id, role)
  }
  if (member.role !== role) {
    member = await prisma.orgMember.update({ where: { id: member.id }, data: { role } })
  }
  if (!member.lastSeenAt || Date.now() - member.lastSeenAt.getTime() > REFRESH_MS) {
    member = await refreshFromClerk(member)
  }
  return { org, member, isAdmin: role === 'admin' }
}

/**
 * Two concurrent first requests for the same new user can both see
 * findUnique → null and both attempt create; the loser hits the
 * (clerkUserId, organizationId) unique constraint (P2002). Rather than 500,
 * re-read the winner's row and continue — the caller applies the normal
 * role-sync / hourly-refresh logic to whatever row comes back.
 */
async function createMember(clerkUserId: string, organizationId: string, role: string): Promise<OrgMember> {
  try {
    return await prisma.orgMember.create({ data: { clerkUserId, organizationId, role } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.orgMember.findUnique({
        where: { clerkUserId_organizationId: { clerkUserId, organizationId } },
      })
      if (existing) return existing
    }
    throw err
  }
}

async function refreshFromClerk(member: OrgMember): Promise<OrgMember> {
  const data: Record<string, unknown> = { lastSeenAt: new Date() }
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(member.clerkUserId)
    const first = user.firstName?.trim() || null
    const last = user.lastName?.trim() || null
    data.name = [first, last].filter(Boolean).join(' ') || user.username || null
    data.email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null
    if (!member.senderFirstName && first) data.senderFirstName = first
    if (!member.senderLastName && last) data.senderLastName = last
  } catch (err) {
    console.warn('[resolveMember] Clerk refresh failed — keeping stored details', err)
  }
  return prisma.orgMember.update({ where: { id: member.id }, data })
}
