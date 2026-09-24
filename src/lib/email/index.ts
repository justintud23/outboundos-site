import { SendGridProvider } from './sendgrid'
import { GraphEmailProvider } from './graph/provider'
import type { EmailProvider } from './provider'

// Per-process singletons. Reset on serverless cold starts (harmless).
let _sendgrid: EmailProvider | null = null
const _graph = new Map<string, EmailProvider>()

/**
 * Microsoft Graph when the org has connected a Microsoft 365 tenant and the
 * app registration is configured; SendGrid otherwise (legacy / local dev).
 */
export function getEmailProvider(opts: { msTenantId?: string | null } = {}): EmailProvider {
  if (opts.msTenantId && process.env.MS_GRAPH_CLIENT_ID) {
    let provider = _graph.get(opts.msTenantId)
    if (!provider) {
      provider = new GraphEmailProvider(opts.msTenantId)
      _graph.set(opts.msTenantId, provider)
    }
    return provider
  }

  if (_sendgrid) return _sendgrid
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) throw new Error('SENDGRID_API_KEY is not set')
  _sendgrid = new SendGridProvider(apiKey)
  return _sendgrid
}

export type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'
