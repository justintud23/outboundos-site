import { prisma } from '@/lib/db/prisma'

let connectionWarningLogged = false

/**
 * Verifies the database is reachable by running a lightweight query.
 * Throws a human-readable error if the connection fails.
 * In development, the warning is logged only once per process lifetime.
 */
export async function checkDatabaseConnection(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    if (process.env.NODE_ENV === 'development' && !connectionWarningLogged) {
      connectionWarningLogged = true
      console.error('[db] Connection failed. Ensure PostgreSQL is running and DATABASE_URL is correct.')
    }
    throw new Error(
      'Database connection failed. Ensure PostgreSQL is running and DATABASE_URL is correct.',
    )
  }
}
