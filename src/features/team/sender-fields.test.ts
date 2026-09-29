import { describe, it, expect } from 'vitest'
import { withSenderFields } from './sender-fields'
import { renderTemplate } from '@/features/sequences/render-template'

describe('withSenderFields', () => {
  it('adds sender merge fields that render', () => {
    const lead = withSenderFields({ firstName: 'Jo', customFields: { city: 'Buffalo' } }, { senderFirstName: 'Mike', senderName: 'Mike Rossi' })
    expect(renderTemplate('Thanks,\n{senderFirstName|}', lead)).toBe('Thanks,\nMike')
    expect(renderTemplate('{senderName|Our team}', lead)).toBe('Mike Rossi')
  })
  it('uses the fallback when there is no sender', () => {
    const lead = withSenderFields({ customFields: null }, { senderFirstName: null, senderName: null })
    expect(renderTemplate('Thanks,\n{senderFirstName|}', lead)).toBe('Thanks,\n')
  })
  it('never overrides a real CSV column with the same key', () => {
    const lead = withSenderFields({ customFields: { senderFirstName: 'FromCsv' } }, { senderFirstName: 'Mike', senderName: 'Mike R' })
    expect(renderTemplate('{senderFirstName|}', lead)).toBe('FromCsv')
  })
})
