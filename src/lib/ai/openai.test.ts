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
import { DraftGenerationError } from './provider'

describe('OpenAIProvider construction', () => {
  it('configures the client with a timeout and bounded retries', () => {
    vi.clearAllMocks()
    new OpenAIProvider('test-key', 'gpt-4o')
    const ctor = OpenAI as unknown as ReturnType<typeof vi.fn>
    expect(ctor).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-key', timeout: 30_000, maxRetries: 2 }),
    )
  })
})

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

  it('returns a score and reason for each lead (JSON-mode { scores: [...] })', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scores: [{ leadId: 'lead-1', score: 75, reason: 'Senior title at mid-size company' }],
            }),
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

  it('requests JSON mode (response_format json_object)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ scores: [] }) } }],
    })
    await provider.scoreLeads([{ id: 'lead-1', email: 'a@b.com' }], 'Score.')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
    )
  })

  it('leaves leads UNSCORED (score: null), not a fake 0, when parsing fails', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com' }],
      'Score this lead.',
    )

    expect(result[0]?.score).toBeNull()
    expect(result[0]?.reason).toMatch(/unscored/i)
  })

  it('leaves leads unscored when the AI call itself throws (transport failure)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('connection reset'))

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com' }],
      'Score this lead.',
    )

    expect(result[0]?.score).toBeNull()
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

  it('returns subject and body from AI response (and requests JSON mode)', async () => {
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
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: { type: 'json_object' } }),
    )
  })

  it('SURFACES DraftGenerationError on parse failure (never a silent empty body)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    await expect(
      provider.draftEmail({ id: 'lead-1', email: 'jane@acme.com' }, 'You are a sales email writer.'),
    ).rejects.toBeInstanceOf(DraftGenerationError)
  })

  it('SURFACES DraftGenerationError when the model returns an empty body', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ subject: 'Hi', body: '' }) } }],
    })

    await expect(
      provider.draftEmail({ id: 'lead-1', email: 'jane@acme.com' }, 'prompt'),
    ).rejects.toBeInstanceOf(DraftGenerationError)
  })

  it('SURFACES DraftGenerationError when the AI call throws (transport failure)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('gateway timeout'))

    await expect(
      provider.draftEmail({ id: 'lead-1', email: 'jane@acme.com' }, 'prompt'),
    ).rejects.toBeInstanceOf(DraftGenerationError)
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

describe('OpenAIProvider.classifyReply', () => {
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

  it('returns classification and confidence from AI response (JSON mode + temperature)', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'POSITIVE', confidence: 0.95 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'I am very interested!' }, 'classify prompt')

    expect(result).toEqual({ classification: 'POSITIVE', confidence: 0.95 })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.1, response_format: { type: 'json_object' } }),
    )
  })

  it('returns UNKNOWN with 0 confidence on parse failure', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json' } }],
    })

    const result = await provider.classifyReply({ rawBody: 'some reply' }, 'classify prompt')

    expect(result).toEqual({ classification: 'UNKNOWN', confidence: 0 })
  })

  it('returns UNKNOWN with 0 confidence on unrecognised classification value', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'GIBBERISH', confidence: 0.9 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'some reply' }, 'classify prompt')

    expect(result).toEqual({ classification: 'UNKNOWN', confidence: 0 })
  })

  it('clamps confidence to 0–1 range', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'NEGATIVE', confidence: 1.5 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'Not interested' }, 'classify prompt')

    expect(result.confidence).toBe(1)
    expect(result.classification).toBe('NEGATIVE')
  })

  it('passes rawBody as the user message and the template (+ JSON instruction) as system', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'OUT_OF_OFFICE', confidence: 0.99 }) } }],
    })

    await provider.classifyReply({ rawBody: 'I am on holiday' }, 'system prompt here')

    const arg = mockCreate.mock.calls[0]?.[0] as {
      messages: { role: string; content: string }[]
    }
    const system = arg.messages.find((m) => m.role === 'system')
    const user = arg.messages.find((m) => m.role === 'user')
    // The template is preserved; a JSON-object instruction is appended so JSON
    // mode's "must contain json" requirement holds even for custom templates.
    expect(system?.content).toContain('system prompt here')
    expect(system?.content.toLowerCase()).toContain('json')
    expect(user?.content).toBe('I am on holiday')
  })
})
