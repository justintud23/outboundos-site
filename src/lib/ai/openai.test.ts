import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock openai before importing the adapter
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      }
    }),
  }
})

import OpenAI from 'openai'
import { OpenAIProvider } from './openai'

describe('OpenAIProvider.scoreLeads', () => {
  let provider: OpenAIProvider
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new OpenAIProvider('test-key', 'gpt-4o')
    const client = (OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } }
    }
    mockCreate = client.chat.completions.create
  })

  it('returns a score and reason for each lead', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { leadId: 'lead-1', score: 75, reason: 'Senior title at mid-size company' },
            ]),
          },
        },
      ],
    })

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com', title: 'VP of Sales', company: 'Acme' }],
      'Score this lead 0-100.',
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ leadId: 'lead-1', score: 75 })
  })

  it('returns score 0 with error reason when parsing fails', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com' }],
      'Score this lead.',
    )

    expect(result[0]?.score).toBe(0)
    expect(result[0]?.reason).toContain('parse')
  })
})

describe('OpenAIProvider.draftEmail', () => {
  let provider: OpenAIProvider
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new OpenAIProvider('test-key', 'gpt-4o')
    const client = (OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } }
    }
    mockCreate = client.chat.completions.create
  })

  it('returns subject and body from AI response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ subject: 'Hello Jane', body: 'Hi Jane...' }) } },
      ],
    })

    const result = await provider.draftEmail(
      { id: 'lead-1', email: 'jane@acme.com', firstName: 'Jane', company: 'Acme' },
      'You are a sales email writer.',
    )

    expect(result).toEqual({ subject: 'Hello Jane', body: 'Hi Jane...' })
  })

  it('returns fallback subject and empty body on parse failure', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    const result = await provider.draftEmail(
      { id: 'lead-1', email: 'jane@acme.com' },
      'You are a sales email writer.',
    )

    expect(result.subject).toBe('Draft for jane@acme.com')
    expect(result.body).toBe('')
  })
})

describe('getAIProvider', () => {
  it('throws if OPENAI_API_KEY is not set', async () => {
    vi.resetModules()
    const { getAIProvider } = await import('./router')
    const original = process.env['OPENAI_API_KEY']
    delete process.env['OPENAI_API_KEY']
    expect(() => getAIProvider()).toThrow('OPENAI_API_KEY is not set')
    if (original !== undefined) process.env['OPENAI_API_KEY'] = original
  })
})
