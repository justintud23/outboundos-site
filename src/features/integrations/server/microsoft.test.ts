import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { update: vi.fn() }, mailbox: { createMany: vi.fn() } },
}))
vi.mock('@/features/deliverability/server/domain-health', () => ({
  ensureDomainRows: vi.fn().mockResolvedValue([{ id: 'dh-1', domain: 'getacmesnow.com' }]),
  checkDomain: vi.fn().mockResolvedValue({}),
}))

import { prisma } from '@/lib/db/prisma'
import { ensureDomainRows, checkDomain } from '@/features/deliverability/server/domain-health'
import { buildAdminConsentUrl, saveTenant, importGraphMailboxes, TenantMismatchError } from './microsoft'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_GRAPH_CLIENT_ID = 'cid'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  process.env.MS_GRAPH_TENANT_ID = '72F988BF-86F1-41AF-91AB-2D7CD011DB47'
  ;(ensureDomainRows as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'dh-1', domain: 'getacmesnow.com' }])
  ;(checkDomain as ReturnType<typeof vi.fn>).mockResolvedValue({})
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
  it('refuses a tenant other than the pinned MS_GRAPH_TENANT_ID (I5)', async () => {
    await expect(saveTenant('org-1', '11111111-2222-3333-4444-555555555555')).rejects.toBeInstanceOf(TenantMismatchError)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
  it('refuses to connect at all when MS_GRAPH_TENANT_ID is not set (I5)', async () => {
    delete process.env.MS_GRAPH_TENANT_ID
    await expect(saveTenant('org-1', '72f988bf-86f1-41af-91ab-2d7cd011db47')).rejects.toThrow(/MS_GRAPH_TENANT_ID/)
    expect(prisma.organization.update).not.toHaveBeenCalled()
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
    expect(ensureDomainRows).toHaveBeenCalledWith('org-1')
    expect(checkDomain).toHaveBeenCalledWith('dh-1')
  })
  it('does not reject the import when checking a new domain fails', async () => {
    ;(prisma.mailbox.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    ;(checkDomain as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('dns boom'))
    await expect(
      importGraphMailboxes('org-1', [{ id: 'u1', email: 'mike@getacmesnow.com', displayName: 'Mike Smith' }]),
    ).resolves.toEqual({ created: 1 })
  })
  it('does not reject the import when ensureDomainRows itself fails', async () => {
    ;(prisma.mailbox.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
    ;(ensureDomainRows as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
    await expect(
      importGraphMailboxes('org-1', [
        { id: 'u1', email: 'mike@getacmesnow.com', displayName: 'Mike Smith' },
        { id: 'u2', email: 'amy@getacmesnow.com', displayName: 'Amy Lee' },
      ]),
    ).resolves.toEqual({ created: 2 })
  })
  it('logs a rejected checkDomain instead of swallowing it silently', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(prisma.mailbox.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    ;(checkDomain as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('dns boom'))
    await importGraphMailboxes('org-1', [{ id: 'u1', email: 'mike@getacmesnow.com', displayName: 'Mike Smith' }])
    expect(errorSpy).toHaveBeenCalledWith(
      '[importGraphMailboxes] check getacmesnow.com failed',
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })
})
