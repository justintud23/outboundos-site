import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/templates/server/update-template', () => ({ updateTemplate: vi.fn() }))
vi.mock('@/features/templates/server/set-active-template', () => ({ setActiveTemplate: vi.fn() }))
vi.mock('@/features/templates/server/duplicate-template', () => ({ duplicateTemplate: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { updateTemplate } from '@/features/templates/server/update-template'
import { setActiveTemplate } from '@/features/templates/server/set-active-template'
import { duplicateTemplate } from '@/features/templates/server/duplicate-template'
import { TemplateNotFoundError } from '@/features/templates/types'
import { PATCH } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { name: 'Renamed' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'tpl-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(updateTemplate).mockResolvedValue({ id: 'tpl-1', name: 'Renamed' } as never)
  vi.mocked(setActiveTemplate).mockResolvedValue({ id: 'tpl-1', isActive: true } as never)
  vi.mocked(duplicateTemplate).mockResolvedValue({ id: 'tpl-2' } as never)
})

describe('PATCH /api/templates/[id]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not update', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(updateTemplate).not.toHaveBeenCalled()
  })

  it('200 updates the template for an admin', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(updateTemplate).toHaveBeenCalledWith({
      organizationId: 'org-1',
      templateId: 'tpl-1',
      name: 'Renamed',
      body: undefined,
      notes: undefined,
    })
  })

  it('activates via action=activate', async () => {
    const res = await call({ action: 'activate' })
    expect(res.status).toBe(200)
    expect(setActiveTemplate).toHaveBeenCalledWith({ organizationId: 'org-1', templateId: 'tpl-1' })
  })

  it('201 duplicates via action=duplicate', async () => {
    const res = await call({ action: 'duplicate' })
    expect(res.status).toBe(201)
    expect(duplicateTemplate).toHaveBeenCalledWith({ organizationId: 'org-1', templateId: 'tpl-1' })
  })

  it('404 when the template is not found', async () => {
    vi.mocked(updateTemplate).mockRejectedValue(new TemplateNotFoundError('tpl-1'))
    expect((await call()).status).toBe(404)
  })
})
