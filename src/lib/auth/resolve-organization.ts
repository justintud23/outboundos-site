import { prisma } from '@/lib/db/prisma'
import type { Organization } from '@prisma/client'

/**
 * Resolves a Clerk org ID to the internal Organization record.
 * Creates the row on first access (e.g. new org that hasn't touched the DB yet).
 * Always returns the internal Organization — use `.id` for all Prisma FK columns.
 */
export async function resolveOrganization(clerkOrgId: string): Promise<Organization> {
  return prisma.organization.upsert({
    where: { clerkId: clerkOrgId },
    create: { clerkId: clerkOrgId, name: clerkOrgId },
    update: {},
  })
}
