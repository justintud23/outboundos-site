import { prisma } from '@/lib/db/prisma'
import { checkDatabaseConnection } from '@/lib/db/health'
import type { Organization } from '@prisma/client'

const DB_CONNECTION_MESSAGES = ['ECONNREFUSED', 'ENOTFOUND', 'connect ETIMEDOUT', 'Connection refused']

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return DB_CONNECTION_MESSAGES.some((s) => msg.includes(s))
}

/**
 * Resolves a Clerk org ID to the internal Organization record.
 * Creates the row on first access (e.g. new org that hasn't touched the DB yet).
 * Always returns the internal Organization — use `.id` for all Prisma FK columns.
 */
export async function resolveOrganization(clerkOrgId: string | null | undefined): Promise<Organization> {
  if (!clerkOrgId) {
    throw new Error(`resolveOrganization: clerkOrgId is required, got ${JSON.stringify(clerkOrgId)}`)
  }

  if (process.env.NODE_ENV === 'development') {
    await checkDatabaseConnection()
  }

  try {
    return await prisma.organization.upsert({
      where: { clerkId: clerkOrgId },
      create: { clerkId: clerkOrgId, name: clerkOrgId },
      update: {},
    })
  } catch (err) {
    if (isConnectionError(err)) {
      throw new Error(
        'Database connection failed. Ensure PostgreSQL is running and DATABASE_URL is correct.',
      )
    }
    throw err
  }
}
