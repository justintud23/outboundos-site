import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/salesforce/server/oauth', () => ({
  revokeToken: vi.fn(),
}))

vi.mock('@/features/salesforce/server/connection', () => ({
  getConnection: vi.fn(),
  deleteConnection: vi.fn(),
}))

vi.mock('@/lib/crypto/token-cipher', () => ({
  decryptToken: vi.fn((enc: string) => `plain:${enc}`),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { revokeToken } from '@/features/salesforce/server/oauth'
import { getConnection, deleteConnection } from '@/features/salesforce/server/connection'
import { DELETE } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockRevokeToken = revokeToken as unknown as ReturnType<typeof vi.fn>
const mockGetConnection = getConnection as unknown as ReturnType<typeof vi.fn>
const mockDeleteConnection = deleteConnection as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'org-1' }
const admin = { org: fakeOrg, member: { id: 'mem-admin' }, isAdmin: true }
const rep = { org: fakeOrg, member: { id: 'mem-rep' }, isAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
  mockGetConnection.mockResolvedValue(null)
  mockDeleteConnection.mockResolvedValue(undefined)
  mockRevokeToken.mockResolvedValue(undefined)
})

describe('DELETE /api/integrations/salesforce', () => {
  it('blocks a non-admin member with 403 ADMIN_ONLY', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await DELETE()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(mockDeleteConnection).not.toHaveBeenCalled()
  })

  it('403 without an active org', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await DELETE()
    expect(res.status).toBe(403)
    expect(mockDeleteConnection).not.toHaveBeenCalled()
  })

  it('an admin revokes the token and deletes the connection when connected', async () => {
    mockGetConnection.mockResolvedValue({
      loginHost: 'https://login.salesforce.com',
      refreshTokenEnc: 'enc-token',
    })

    const res = await DELETE()

    expect(mockRevokeToken).toHaveBeenCalledWith('https://login.salesforce.com', 'plain:enc-token')
    expect(mockDeleteConnection).toHaveBeenCalledWith('org-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('a revoke failure still deletes the connection and returns ok', async () => {
    mockGetConnection.mockResolvedValue({
      loginHost: 'https://login.salesforce.com',
      refreshTokenEnc: 'enc-token',
    })
    mockRevokeToken.mockRejectedValue(new Error('network down'))

    const res = await DELETE()

    expect(mockDeleteConnection).toHaveBeenCalledWith('org-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 200 even when not connected, without attempting revoke', async () => {
    mockGetConnection.mockResolvedValue(null)
    const res = await DELETE()
    expect(mockRevokeToken).not.toHaveBeenCalled()
    expect(mockDeleteConnection).toHaveBeenCalledWith('org-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
