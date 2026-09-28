import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/templates/server/create-template', () => ({ createTemplate: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { createTemplate } from '@/features/templates/server/create-template'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const VALID_BODY = { name: 'T', promptType: 'EMAIL_DRAFT', body: 'Body text' }

const call = (body: unknown = VALID_BODY) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(createTemplate).mockResolvedValue({ id: 'tpl-1' } as never)
})

describe('POST /api/templates', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not create', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(createTemplate).not.toHaveBeenCalled()
  })

  it('400 when required fields are missing', async () => {
    const res = await call({ name: 'T' })
    expect(res.status).toBe(400)
  })

  it('400 for an invalid promptType', async () => {
    const res = await call({ ...VALID_BODY, promptType: 'MADE_UP' })
    expect(res.status).toBe(400)
  })

  it('201 creates the template for an admin', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(createTemplate).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'T',
      promptType: 'EMAIL_DRAFT',
      body: 'Body text',
      notes: undefined,
    })
  })
})
