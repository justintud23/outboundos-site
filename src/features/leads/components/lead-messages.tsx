import { MessageBubble } from '@/features/inbox/components/message-bubble'
import { Mail } from 'lucide-react'
import type { ThreadMessageDTO } from '@/features/inbox/types'

interface LeadMessagesProps {
  messages: ThreadMessageDTO[]
}

export function LeadMessages({ messages }: LeadMessagesProps) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface-raised)] flex items-center justify-center">
          <Mail size={22} className="text-[var(--text-muted)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">No messages yet</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Outbound emails and replies will appear here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}
