import { prisma } from '@/lib/db/prisma'

export class TeamValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamValidationError'
    Object.setPrototypeOf(this, TeamValidationError.prototype)
  }
}

// Same shape as features/settings/server/sending-settings.ts's escalation email check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_NAME_LENGTH = 40

export interface TeamMemberDTO {
  id: string
  name: string | null
  email: string | null
  role: string
  escalationEmail: string | null
  senderFirstName: string | null
  senderLastName: string | null
  mailboxCount: number
  lastSeenAt: Date | null
}

export interface TeamDTO {
  members: TeamMemberDTO[]
  copyAdminOnReplies: boolean
  unassignedCampaigns: number
  unassignedMailboxes: number
  bannerDismissed: boolean
}

export interface UpdateMemberPatch {
  escalationEmail?: string | null
  senderFirstName?: string | null
  senderLastName?: string | null
}

export interface UpdateTeamSettingsPatch {
  copyAdminOnReplies?: boolean
  dismissOwnershipBanner?: true
}

/** Every member of the org, with mailbox counts and org-wide assignment/settings context for Settings and the ownership banner. */
export async function getTeam(organizationId: string): Promise<TeamDTO> {
  const [members, mailboxCounts, unassignedCampaigns, unassignedMailboxes, org] = await Promise.all([
    prisma.orgMember.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        escalationEmail: true,
        senderFirstName: true,
        senderLastName: true,
        lastSeenAt: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.mailbox.groupBy({
      by: ['ownerId'],
      where: { organizationId, ownerId: { not: null } },
      _count: { _all: true },
    }),
    prisma.campaign.count({ where: { organizationId, ownerId: null } }),
    prisma.mailbox.count({ where: { organizationId, ownerId: null } }),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { copyAdminOnReplies: true, ownershipBannerDismissedAt: true },
    }),
  ])

  const mailboxCountByOwner = new Map(mailboxCounts.map((row) => [row.ownerId, row._count._all]))

  return {
    members: members.map((m) => ({ ...m, mailboxCount: mailboxCountByOwner.get(m.id) ?? 0 })),
    copyAdminOnReplies: org.copyAdminOnReplies,
    unassignedCampaigns,
    unassignedMailboxes,
    bannerDismissed: org.ownershipBannerDismissedAt !== null,
  }
}

function cleanName(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  const trimmed = value?.trim() || null
  if (trimmed && trimmed.length > MAX_NAME_LENGTH) {
    throw new TeamValidationError(`Name must be ${MAX_NAME_LENGTH} characters or fewer`)
  }
  return trimmed
}

/**
 * Updates a member's own settings (escalation email, sender names). Empty
 * strings become null. Org-scoped: returns false when the member isn't in
 * this org (updateMany touches 0 rows) so the route can 404.
 */
export async function updateMember(organizationId: string, memberId: string, patch: UpdateMemberPatch): Promise<boolean> {
  const data: Record<string, unknown> = {}

  if (patch.escalationEmail !== undefined) {
    const email = patch.escalationEmail?.trim() || null
    if (email && !EMAIL_RE.test(email)) throw new TeamValidationError('Invalid escalation email')
    data.escalationEmail = email
  }
  if (patch.senderFirstName !== undefined) data.senderFirstName = cleanName(patch.senderFirstName)
  if (patch.senderLastName !== undefined) data.senderLastName = cleanName(patch.senderLastName)

  const result = await prisma.orgMember.updateMany({ where: { id: memberId, organizationId }, data })
  return result.count > 0
}

/** Updates org-wide team settings: the reply-copy toggle and/or dismissing the ownership banner. */
export async function updateTeamSettings(organizationId: string, patch: UpdateTeamSettingsPatch): Promise<void> {
  const data: Record<string, unknown> = {}
  if (patch.copyAdminOnReplies !== undefined) data.copyAdminOnReplies = patch.copyAdminOnReplies
  if (patch.dismissOwnershipBanner) data.ownershipBannerDismissedAt = new Date()

  if (Object.keys(data).length === 0) return
  await prisma.organization.update({ where: { id: organizationId }, data })
}
