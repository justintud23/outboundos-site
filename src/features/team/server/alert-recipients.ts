import { prisma } from '@/lib/db/prisma'

type Person = { escalationEmail: string | null; email: string | null } | null | undefined

function address(p: Person): string | null {
  return p?.escalationEmail?.trim() || p?.email?.trim() || null
}

/** Reply alerts go to the owning rep (lead owner → mailbox owner → org), CC the org when enabled. */
export async function resolveAlertRecipients(
  organizationId: string,
  refs: { leadId?: string | null; mailboxId?: string | null } = {},
): Promise<{ to: string | null; cc: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { escalationEmail: true, copyAdminOnReplies: true } })
  const orgAddress = org?.escalationEmail?.trim() || null
  const owner = { select: { escalationEmail: true, email: true } } as const
  const lead = refs.leadId ? await prisma.lead.findFirst({ where: { id: refs.leadId, organizationId }, select: { owner } }) : null
  const mailbox = refs.mailboxId ? await prisma.mailbox.findFirst({ where: { id: refs.mailboxId, organizationId }, select: { owner } }) : null
  const to = address(lead?.owner) ?? address(mailbox?.owner) ?? orgAddress
  const cc = org?.copyAdminOnReplies && orgAddress && to && orgAddress.toLowerCase() !== to.toLowerCase() ? orgAddress : null
  return { to, cc }
}
