import { describe, it, expect } from 'vitest'
import { CsvRowSchema, CreateLeadSchema } from './schemas'

describe('CsvRowSchema', () => {
  it('parses a valid CSV row', () => {
    const result = CsvRowSchema.safeParse({
      email: 'alice@acme.com',
      first_name: 'Alice',
      last_name: 'Smith',
      company: 'Acme',
      title: 'VP Sales',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('alice@acme.com')
      expect(result.data.first_name).toBe('Alice')
    }
  })

  it('rejects a row missing email', () => {
    const result = CsvRowSchema.safeParse({ first_name: 'Alice' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = CsvRowSchema.safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
  })
})

describe('CreateLeadSchema', () => {
  it('parses a valid lead creation input', () => {
    const result = CreateLeadSchema.safeParse({
      organizationId: 'org_123',
      email: 'bob@corp.com',
      firstName: 'Bob',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('bob@corp.com')
      expect(result.data.organizationId).toBe('org_123')
    }
  })

  it('requires organizationId', () => {
    const result = CreateLeadSchema.safeParse({ email: 'bob@corp.com' })
    expect(result.success).toBe(false)
  })

  it('defaults source to CSV when omitted', () => {
    const result = CreateLeadSchema.safeParse({
      organizationId: 'org_123',
      email: 'bob@corp.com',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('CSV')
    }
  })

  it('accepts empty string for linkedinUrl', () => {
    const result = CreateLeadSchema.safeParse({
      organizationId: 'org_123',
      email: 'bob@corp.com',
      linkedinUrl: '',
    })
    expect(result.success).toBe(true)
  })
})
