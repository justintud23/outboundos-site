import type { MessageEventType } from '@prisma/client'

const EVENT_TYPE_MAP: Record<string, MessageEventType> = {
  delivered:   'DELIVERED',
  open:        'OPENED',
  click:       'CLICKED',
  bounce:      'BOUNCED',
  spamreport:  'SPAM_REPORT',
  unsubscribe: 'UNSUBSCRIBED',
  deferred:    'DEFERRED',
  dropped:     'DROPPED',
}

export function mapEventType(sendGridEvent: string): MessageEventType | null {
  return EVENT_TYPE_MAP[sendGridEvent] ?? null
}
