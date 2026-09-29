export const SF_API_VERSION = 'v62.0'
/** Timeout for every outbound Salesforce fetch (REST and OAuth). */
export const SF_FETCH_TIMEOUT_MS = 10_000
export type SfEnv = 'production' | 'sandbox'

export function getSalesforceAppConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function loginHostFor(env: SfEnv): string {
  return env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
}

export function salesforceCallbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/integrations/salesforce/callback`
}
