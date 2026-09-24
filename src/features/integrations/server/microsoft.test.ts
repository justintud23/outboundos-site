import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { update: vi.fn() }, mailbox: { createMany: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { buildAdminConsentUrl, saveTenant, importGraphMailboxes } from './microsoft'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_GRAPH_CLIENT_ID = 'cid'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

describe('microsoft integration', () => {
  it('builds the admin-consent URL with redirect and state', () => {
    const url = new URL(buildAdminConsentUrl('st8'))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/integrations/microsoft/callback')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('scope')).toBe('https://graph.microsoft.com/.default')
  })
  it('rejects a malformed tenant id', async () => {
    await expect(saveTenant('org-1', 'not a guid')).rejects.toThrow(/tenant/)
  })
  it('saves a GUID tenant id', async () => {
    await saveTenant('org-1', '72f988bf-86f1-41af-91ab-2d7cd011db47')
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { msTenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47', sendingPaused: false, pausedReason: null },
    })
  })
  it('imports Graph mailboxes with warmup on, 30/day, skipping duplicates', async () => {
    ;(prisma.mailbox.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
    const out = await importGraphMailboxes('org-1', [
      { id: 'u1', email: 'Mike@GetAcmeSnow.com', displayName: 'Mike Smith' },
      { id: 'u2', email: 'amy@getacmesnow.com', displayName: 'Amy Lee' },
    ])
    expect(out).toEqual({ created: 2 })
    expect(prisma.mailbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ organizationId: 'org-1', email: 'mike@getacmesnow.com', displayName: 'Mike Smith', provider: 'MICROSOFT_GRAPH', graphUserId: 'u1', dailyLimit: 30, warmupEnabled: true }),
        expect.objectContaining({ email: 'amy@getacmesnow.com', graphUserId: 'u2' }),
      ],
      skipDuplicates: true,
    })
  })
})
