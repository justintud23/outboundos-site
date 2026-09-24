import { describe, it, expect } from 'vitest'
import { buildComplianceFooter } from './compliance'

describe('buildComplianceFooter', () => {
  const sender = { businessName: 'Acme Snow & Paving', postalAddress: '123 Main St\nBuffalo, NY 14201' }
  const unsubscribe = { url: 'https://app.test/api/unsubscribe?token=abc' }

  it('appends business name, postal address and the unsubscribe link (CAN-SPAM)', () => {
    expect(buildComplianceFooter('Hi Jane,\n\nThanks.\n', sender, unsubscribe)).toBe(
      'Hi Jane,\n\nThanks.\n\n--\nAcme Snow & Paving\n123 Main St\nBuffalo, NY 14201\n' +
        "If you'd prefer not to hear from me again, unsubscribe here: https://app.test/api/unsubscribe?token=abc",
    )
  })

  it('omits the business name line when it is not set', () => {
    const out = buildComplianceFooter('Hi', { businessName: null, postalAddress: 'PO Box 9, Buffalo, NY' }, unsubscribe)
    expect(out).toBe(
      "Hi\n\n--\nPO Box 9, Buffalo, NY\nIf you'd prefer not to hear from me again, unsubscribe here: https://app.test/api/unsubscribe?token=abc",
    )
  })

  it('returns the body unchanged when there is nothing to add', () => {
    expect(buildComplianceFooter('Hi', undefined, undefined)).toBe('Hi')
  })
})
