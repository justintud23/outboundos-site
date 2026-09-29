import { describe, it, expect, afterEach, vi } from 'vitest'
import { getSalesforceAppConfig, loginHostFor, salesforceCallbackUrl } from './config'

afterEach(() => vi.unstubAllEnvs())

describe('salesforce config', () => {
  it('is null unless both client id and secret are set', () => {
    vi.stubEnv('SALESFORCE_CLIENT_ID', 'id'); vi.stubEnv('SALESFORCE_CLIENT_SECRET', '')
    expect(getSalesforceAppConfig()).toBeNull()
    vi.stubEnv('SALESFORCE_CLIENT_SECRET', 'secret')
    expect(getSalesforceAppConfig()).toEqual({ clientId: 'id', clientSecret: 'secret' })
  })
  it('maps environments to login hosts', () => {
    expect(loginHostFor('production')).toBe('https://login.salesforce.com')
    expect(loginHostFor('sandbox')).toBe('https://test.salesforce.com')
  })
  it('builds the callback url from NEXT_PUBLIC_APP_URL without a double slash', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/')
    expect(salesforceCallbackUrl()).toBe('https://app.example.com/api/integrations/salesforce/callback')
  })
})
