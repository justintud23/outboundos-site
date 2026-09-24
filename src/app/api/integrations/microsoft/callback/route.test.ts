import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

const mockCookieGet = vi.fn()
const mockCookieDelete = vi.fn()

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookieGet, delete: mockCookieDelete }),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

const { actualSaveTenant } = vi.hoisted(() => ({
  actualSaveTenant: { fn: null as null | ((orgId: string, tenant: string) => Promise<void>) },
}))

vi.mock('@/features/integrations/server/microsoft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/integrations/server/microsoft')>()
  actualSaveTenant.fn = actual.saveTenant
  return {
    ...actual,
    saveTenant: vi.fn(),
  }
})

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { saveTenant } from '@/features/integrations/server/microsoft'
import { GET } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockSaveTenant = saveTenant as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id' }

function makeRequest(query: string): Request {
  return new Request(`https://app.test/api/integrations/microsoft/callback${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
  mockResolveOrganization.mockResolvedValue(fakeOrg)
})

describe('GET /api/integrations/microsoft/callback', () => {
  it('redirects to state_mismatch and does not save tenant when state does not match the cookie', async () => {
    mockCookieGet.mockReturnValue({ value: 'expected-state' })

    const req = makeRequest('?state=wrong-state&admin_consent=True&tenant=72f988bf-86f1-41af-91ab-2d7cd011db47')
    const res = await GET(req)

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.test/settings?microsoft=state_mismatch')
    expect(mockSaveTenant).not.toHaveBeenCalled()
  })

  it('redirects to denied when admin_consent is False', async () => {
    mockCookieGet.mockReturnValue({ value: 'st8' })

    const req = makeRequest('?state=st8&admin_consent=False&tenant=72f988bf-86f1-41af-91ab-2d7cd011db47')
    const res = await GET(req)

    expect(res.headers.get('location')).toBe('https://app.test/settings?microsoft=denied')
    expect(mockSaveTenant).not.toHaveBeenCalled()
  })

  it('saves the tenant and redirects to connected on success', async () => {
    mockCookieGet.mockReturnValue({ value: 'st8' })
    mockSaveTenant.mockResolvedValue(undefined)

    const req = makeRequest('?state=st8&admin_consent=True&tenant=72f988bf-86f1-41af-91ab-2d7cd011db47')
    const res = await GET(req)

    expect(mockSaveTenant).toHaveBeenCalledWith('internal-org-id', '72f988bf-86f1-41af-91ab-2d7cd011db47')
    expect(res.headers.get('location')).toBe('https://app.test/settings?microsoft=connected')
  })

  it('deletes the state cookie', async () => {
    mockCookieGet.mockReturnValue({ value: 'st8' })
    mockSaveTenant.mockResolvedValue(undefined)

    const req = makeRequest('?state=st8&admin_consent=True&tenant=72f988bf-86f1-41af-91ab-2d7cd011db47')
    await GET(req)

    expect(mockCookieDelete).toHaveBeenCalledWith('ms_connect_state')
  })

  it('rejects a tenant that is not the pinned MS_GRAPH_TENANT_ID → tenant_mismatch, nothing saved (I5)', async () => {
    process.env.MS_GRAPH_TENANT_ID = '72f988bf-86f1-41af-91ab-2d7cd011db47'
    mockCookieGet.mockReturnValue({ value: 'st8' })
    // Real saveTenant: the pin check rejects before any database write.
    mockSaveTenant.mockImplementation((orgId: string, tenant: string) => actualSaveTenant.fn!(orgId, tenant))

    const req = makeRequest('?state=st8&admin_consent=True&tenant=11111111-2222-3333-4444-555555555555')
    const res = await GET(req)

    expect(res.headers.get('location')).toBe('https://app.test/settings?microsoft=tenant_mismatch')
    delete process.env.MS_GRAPH_TENANT_ID
  })

  it('refuses with error when MS_GRAPH_TENANT_ID is not configured (I5)', async () => {
    delete process.env.MS_GRAPH_TENANT_ID
    mockCookieGet.mockReturnValue({ value: 'st8' })
    mockSaveTenant.mockImplementation((orgId: string, tenant: string) => actualSaveTenant.fn!(orgId, tenant))

    const res = await GET(makeRequest('?state=st8&admin_consent=True&tenant=72f988bf-86f1-41af-91ab-2d7cd011db47'))

    expect(res.headers.get('location')).toBe('https://app.test/settings?microsoft=error')
  })
})
