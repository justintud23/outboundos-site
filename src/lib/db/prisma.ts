import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

// Lazy singleton — only instantiated on first property access, not on import.
// This prevents Next.js build from throwing when DATABASE_URL isn't set at
// build time (it's only needed at request time).
let _client: PrismaClient | undefined

export const prisma = new Proxy({} as PrismaClient, {
  get(_: PrismaClient, prop: string | symbol) {
    if (!_client) {
      _client = globalForPrisma.prisma ?? createPrismaClient()
      if (process.env.NODE_ENV !== 'production') {
        globalForPrisma.prisma = _client
      }
    }
    const value = (_client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? (value as Function).bind(_client) : value
  },
})
