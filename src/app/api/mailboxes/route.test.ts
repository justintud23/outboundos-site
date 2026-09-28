import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/mailboxes/server/create-mailbox', () => ({ createMailbox: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { createMailbox } from '@/features/mailboxes/server/create-mailbox'
import { MailboxAlreadyExistsError, ManualMailboxNotAllowedError } from '@/features/mailboxes/types'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { email: 'a@x.com', displayName: 'A' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(createMailbox).mockResolvedValue({ id: 'mb-1' } as never)
})

describe('POST /api/mailboxes', () => {
  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(createMailbox).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not create', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(createMailbox).not.toHaveBeenCalled()
  })

  it('400 when email or displayName missing', async () => {
    const res = await call({ email: 'a@x.com' })
    expect(res.status).toBe(400)
  })

  it('409 MAILBOX_ALREADY_EXISTS', async () => {
    vi.mocked(createMailbox).mockRejectedValue(new MailboxAlreadyExistsError())
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('MAILBOX_ALREADY_EXISTS')
  })

  it('409 USE_MICROSOFT_IMPORT', async () => {
    vi.mocked(createMailbox).mockRejectedValue(new ManualMailboxNotAllowedError())
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('USE_MICROSOFT_IMPORT')
  })

  it('201 creates the mailbox for an admin', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(createMailbox).toHaveBeenCalledWith({ organizationId: 'org-1', email: 'a@x.com', displayName: 'A' })
  })
})
