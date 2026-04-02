// Raw shape of a single SendGrid event webhook payload.
// customArgs (draftId, leadId) are merged into the top level by SendGrid.
export interface SendGridRawEvent {
  event: string
  sg_event_id?: string
  sg_message_id?: string
  timestamp?: number
  email?: string
  // customArgs injected at send time
  draftId?: string
  leadId?: string
  [key: string]: unknown
}

export interface MessageEventDTO {
  id: string
  organizationId: string
  outboundMessageId: string
  sgEventId: string | null
  eventType: string
  providerEventType: string | null
  providerTimestamp: Date | null
  rawPayload: unknown
  createdAt: Date
}
