import { OpenAIProvider } from './openai'
import type { AIProvider } from './provider'

// Note: this singleton is per-process. In serverless/lambda environments (Next.js
// deployed to Vercel/etc.), each cold start resets this to null — the singleton
// provides no caching benefit across requests, only within a single invocation.
// Constructing a new OpenAIProvider per cold start is harmless (no persistent state).
let _provider: AIProvider | null = null

export function getAIProvider(): AIProvider {
  if (_provider) return _provider

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  _provider = new OpenAIProvider(apiKey, model)
  return _provider
}
