import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    orgMember: { findMany: vi.fn(), updateMany: vi.fn() },
    mailbox: { groupBy: vi.fn(), count: vi.fn() },
    campaign: { count: vi.fn() },
    organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getTeam, updateMember, updateTeamSettings, TeamValidationError } from './team-settings'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  orgMember: { findMany: Fn; updateMany: Fn }
  mailbox: { groupBy: Fn; count: Fn }
  campaign: { count: Fn }
  organization: { findUniqueOrThrow: Fn; update: Fn }
}

const members = [
  { id: 'm-1', name: 'Alice', email: 'alice@x.com', role: 'admin', escalationEmail: null, senderFirstName: 'Alice', senderLastName: null, lastSeenAt: null },
  { id: 'm-2', name: 'Bob', email: 'bob@x.com', role: 'member', escalationEmail: 'bob-alerts@x.com', senderFirstName: 'Bob', senderLastName: 'Smith', lastSeenAt: new Date('2026-01-01') },
]

beforeEach(() => {
  vi.clearAllMocks()
  p.orgMember.findMany.mockResolvedValue(members)
  p.mailbox.groupBy.mockResolvedValue([{ ownerId: 'm-1', _count: { _all: 2 } }])
  p.campaign.count.mockResolvedValue(3)
  p.mailbox.count.mockResolvedValue(1)
  p.organization.findUniqueOrThrow.mockResolvedValue({ copyAdminOnReplies: true, ownershipBannerDismissedAt: null })
  p.orgMember.updateMany.mockResolvedValue({ count: 1 })
  p.organization.update.mockResolvedValue({})
})

describe('getTeam', () => {
  it('counts mailboxes per member (0 when the member owns none)', async () => {
    const team = await getTeam('org-1')
    expect(team.members.find((m) => m.id === 'm-1')?.mailboxCount).toBe(2)
    expect(team.members.find((m) => m.id === 'm-2')?.mailboxCount).toBe(0)
  })

  it('is org-scoped', async () => {
    await getTeam('org-1')
    expect(p.orgMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1' } }))
    expect(p.mailbox.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', ownerId: { not: null } },
    }))
    expect(p.campaign.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: null } })
    expect(p.mailbox.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: null } })
  })

  it('surfaces unassigned campaigns and mailboxes', async () => {
    const team = await getTeam('org-1')
    expect(team.unassignedCampaigns).toBe(3)
    expect(team.unassignedMailboxes).toBe(1)
  })

  it('surfaces copyAdminOnReplies and bannerDismissed from the org', async () => {
    const team = await getTeam('org-1')
    expect(team.copyAdminOnReplies).toBe(true)
    expect(team.bannerDismissed).toBe(false)
  })

  it('bannerDismissed is true once ownershipBannerDismissedAt is set', async () => {
    p.organization.findUniqueOrThrow.mockResolvedValue({ copyAdminOnReplies: false, ownershipBannerDismissedAt: new Date() })
    const team = await getTeam('org-1')
    expect(team.bannerDismissed).toBe(true)
  })
})

describe('updateMember', () => {
  it('org-scoped updateMany, returns false on 0 rows touched', async () => {
    p.orgMember.updateMany.mockResolvedValue({ count: 0 })
    const ok = await updateMember('org-1', 'm-unknown', { senderFirstName: 'X' })
    expect(ok).toBe(false)
    expect(p.orgMember.updateMany).toHaveBeenCalledWith({
      where: { id: 'm-unknown', organizationId: 'org-1' },
      data: { senderFirstName: 'X' },
    })
  })

  it('returns true when a row was updated', async () => {
    const ok = await updateMember('org-1', 'm-1', { senderFirstName: 'Al' })
    expect(ok).toBe(true)
  })

  it('trims and validates the escalation email', async () => {
    await updateMember('org-1', 'm-1', { escalationEmail: '  alerts@x.com  ' })
    expect(p.orgMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { escalationEmail: 'alerts@x.com' },
    }))
  })

  it('turns an empty escalation email into null', async () => {
    await updateMember('org-1', 'm-1', { escalationEmail: '' })
    expect(p.orgMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { escalationEmail: null },
    }))
  })

  it('rejects an invalid escalation email', async () => {
    await expect(updateMember('org-1', 'm-1', { escalationEmail: 'not-an-email' })).rejects.toThrow(TeamValidationError)
    expect(p.orgMember.updateMany).not.toHaveBeenCalled()
  })

  it('turns empty sender names into null', async () => {
    await updateMember('org-1', 'm-1', { senderFirstName: '', senderLastName: '  ' })
    expect(p.orgMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { senderFirstName: null, senderLastName: null },
    }))
  })

  it('caps sender names at 40 characters', async () => {
    await expect(updateMember('org-1', 'm-1', { senderFirstName: 'x'.repeat(41) })).rejects.toThrow(TeamValidationError)
    expect(p.orgMember.updateMany).not.toHaveBeenCalled()
  })

  it('allows a name exactly 40 characters', async () => {
    await updateMember('org-1', 'm-1', { senderFirstName: 'x'.repeat(40) })
    expect(p.orgMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { senderFirstName: 'x'.repeat(40) },
    }))
  })

  it('only writes fields present in the patch', async () => {
    await updateMember('org-1', 'm-1', { senderLastName: 'Jones' })
    expect(p.orgMember.updateMany).toHaveBeenCalledWith({
      where: { id: 'm-1', organizationId: 'org-1' },
      data: { senderLastName: 'Jones' },
    })
  })
})

describe('updateTeamSettings', () => {
  it('sets copyAdminOnReplies', async () => {
    await updateTeamSettings('org-1', { copyAdminOnReplies: false })
    expect(p.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { copyAdminOnReplies: false },
    })
  })

  it('sets ownershipBannerDismissedAt to a Date on dismiss', async () => {
    await updateTeamSettings('org-1', { dismissOwnershipBanner: true })
    const call = p.organization.update.mock.calls[0]![0] as { data: { ownershipBannerDismissedAt: unknown } }
    expect(call.data.ownershipBannerDismissedAt).toBeInstanceOf(Date)
  })

  it('does nothing when the patch is empty', async () => {
    await updateTeamSettings('org-1', {})
    expect(p.organization.update).not.toHaveBeenCalled()
  })
})
