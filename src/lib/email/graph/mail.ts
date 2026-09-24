import { graphFetch, GraphError } from './client'

export interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  receivedDateTime?: string
  sentDateTime?: string
  isDraft?: boolean
  body?: { contentType: string; content: string }
  bodyPreview?: string
  internetMessageHeaders?: { name: string; value: string }[]
  '@removed'?: unknown
}

interface OutgoingContent {
  to: string
  subject: string
  text: string
}

const mailboxPath = (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`

const DELTA_SELECT =
  'id,conversationId,subject,from,receivedDateTime,sentDateTime,isDraft,body,bodyPreview,internetMessageHeaders'

function messageBody(c: OutgoingContent) {
  return {
    subject: c.subject,
    body: { contentType: 'Text', content: c.text },
    toRecipients: [{ emailAddress: { address: c.to } }],
  }
}

export async function createDraftMessage(
  tenantId: string,
  mailbox: string,
  c: OutgoingContent,
): Promise<{ id: string; conversationId: string | null }> {
  const draft = await graphFetch<GraphMessage>(tenantId, `${mailboxPath(mailbox)}/messages`, {
    method: 'POST',
    body: messageBody(c),
  })
  return { id: draft.id, conversationId: draft.conversationId ?? null }
}

/**
 * Reply to a message WE sent earlier. createReply addresses the reply to the
 * original sender (us), so the PATCH overrides recipients with the lead.
 */
export async function createReplyDraft(
  tenantId: string,
  mailbox: string,
  replyToId: string,
  c: OutgoingContent,
): Promise<{ id: string; conversationId: string | null }> {
  const draft = await graphFetch<GraphMessage>(
    tenantId,
    `${mailboxPath(mailbox)}/messages/${replyToId}/createReply`,
    { method: 'POST', body: {} },
  )
  await graphFetch(tenantId, `${mailboxPath(mailbox)}/messages/${draft.id}`, {
    method: 'PATCH',
    body: messageBody(c),
  })
  return { id: draft.id, conversationId: draft.conversationId ?? null }
}

export async function sendDraftMessage(tenantId: string, mailbox: string, id: string): Promise<void> {
  await graphFetch(tenantId, `${mailboxPath(mailbox)}/messages/${id}/send`, { method: 'POST' })
}

export async function getMessageState(
  tenantId: string,
  mailbox: string,
  id: string,
): Promise<{ state: 'SENT' | 'DRAFT' | 'MISSING'; conversationId: string | null }> {
  try {
    const m = await graphFetch<GraphMessage>(
      tenantId,
      `${mailboxPath(mailbox)}/messages/${id}?$select=id,isDraft,conversationId`,
    )
    return { state: m.isDraft ? 'DRAFT' : 'SENT', conversationId: m.conversationId ?? null }
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return { state: 'MISSING', conversationId: null }
    throw err
  }
}

/**
 * Pull changes for a folder. `resumeLink` is whatever we stored last time
 * (a deltaLink, or a nextLink if we stopped mid-sync). With no link we start a
 * fresh sync limited to mail received since `since`. Returns the link to store.
 */
export async function fetchFolderDelta(
  tenantId: string,
  mailbox: string,
  folder: 'inbox' | 'sentitems',
  resumeLink: string | null,
  since: Date,
  maxPages = 10,
): Promise<{ messages: GraphMessage[]; resumeLink: string }> {
  let url =
    resumeLink ??
    `${mailboxPath(mailbox)}/mailFolders/${folder}/messages/delta?$select=${DELTA_SELECT}&$filter=${encodeURIComponent(
      `receivedDateTime ge ${since.toISOString()}`,
    )}`
  const messages: GraphMessage[] = []

  for (let page = 0; page < maxPages; page++) {
    const res = await graphFetch<{
      value: GraphMessage[]
      '@odata.nextLink'?: string
      '@odata.deltaLink'?: string
    }>(tenantId, url, { prefer: ['odata.maxpagesize=50', 'outlook.body-content-type="text"'] })
    messages.push(...res.value)
    if (res['@odata.deltaLink']) return { messages, resumeLink: res['@odata.deltaLink'] }
    if (!res['@odata.nextLink']) break
    url = res['@odata.nextLink']
  }
  return { messages, resumeLink: url }
}

export async function sendMailAsText(
  tenantId: string,
  fromMailbox: string,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  await graphFetch(tenantId, `${mailboxPath(fromMailbox)}/sendMail`, {
    method: 'POST',
    body: { message: messageBody({ to, subject, text }), saveToSentItems: false },
  })
}

export async function listTenantUsers(
  tenantId: string,
): Promise<{ id: string; email: string; displayName: string }[]> {
  const out: { id: string; email: string; displayName: string }[] = []
  let url: string | undefined = '/users?$select=id,displayName,mail&$top=999'
  while (url) {
    const res: { value: { id: string; mail: string | null; displayName: string }[]; '@odata.nextLink'?: string } =
      await graphFetch(tenantId, url)
    for (const u of res.value) if (u.mail) out.push({ id: u.id, email: u.mail, displayName: u.displayName })
    url = res['@odata.nextLink']
  }
  return out
}
