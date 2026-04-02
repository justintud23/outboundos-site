import { SendGridProvider } from './sendgrid'
import type { EmailProvider } from './provider'

// Per-process singleton. Resets on serverless cold starts (harmless).
let _provider: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (_provider) return _provider

  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) throw new Error('SENDGRID_API_KEY is not set')

  _provider = new SendGridProvider(apiKey)
  return _provider
}

export type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'
