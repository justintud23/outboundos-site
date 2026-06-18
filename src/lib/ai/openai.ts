import OpenAI from 'openai'
import type { AIProvider, LeadScoreInput, LeadScoreOutput, EmailDraftInput, EmailDraftOutput, ReplyClassifyInput, ReplyClassifyOutput, ReplyClassificationValue } from './provider'
import { DraftGenerationError } from './provider'

// Per-request timeout: a hung OpenAI request must not stall the whole operation.
const REQUEST_TIMEOUT_MS = 30_000
// Bounded retries with exponential backoff. The OpenAI SDK retries ONLY transient
// failures (connection errors, request timeouts, 408/409/429, and 5xx) — it never
// retries a 400/validation error. So this is safe: a bad request fails fast.
const MAX_RETRIES = 2

// JSON mode: the model is constrained to emit a valid JSON OBJECT (not a bare
// array), so JSON.parse always succeeds. Note: every prompt that uses this must
// contain the word "json" (an OpenAI requirement) and should ask for an object.
const JSON_RESPONSE_FORMAT = { type: 'json_object' } as const

export class OpenAIProvider implements AIProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: MAX_RETRIES,
    })
    this.model = model
  }

  async scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]> {
    const leadContext = leads
      .map(
        (l) =>
          `ID: ${l.id} | Email: ${l.email} | Name: ${[l.firstName, l.lastName].filter(Boolean).join(' ')} | Title: ${l.title ?? 'Unknown'} | Company: ${l.company ?? 'Unknown'}`,
      )
      .join('\n')

    // JSON mode requires an object at the top level, so the array is nested under
    // a "scores" key.
    const systemPrompt = `${promptTemplate}

Return a JSON object of the form:
{ "scores": [ { "leadId": "<id>", "score": <0-100>, "reason": "<one sentence>" } ] }

Respond with ONLY that JSON object. No markdown, no explanation.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: leadContext },
        ],
        temperature: 0.2,
        response_format: JSON_RESPONSE_FORMAT,
      })

      const content = response.choices[0]?.message.content ?? ''
      const parsed = JSON.parse(content) as { scores?: unknown }
      if (!Array.isArray(parsed.scores)) {
        throw new SyntaxError('Expected a { scores: [...] } object')
      }
      return (parsed.scores as LeadScoreOutput[]).map((item) => ({
        leadId: item.leadId,
        // Clamp numeric scores; if the model omitted/garbled one, mark it unscored
        // rather than inventing a 0.
        score: typeof item.score === 'number' ? Math.max(0, Math.min(100, item.score)) : null,
        reason: item.reason,
      }))
    } catch (err) {
      // Explicit fallback: leave leads UNSCORED (score: null), never a fake 0.
      // Scoring runs during import — degrade so the import still succeeds, but be
      // honest that these weren't scored (null != "scored 0").
      console.warn('[OpenAIProvider.scoreLeads] scoring failed — leaving leads unscored', err)
      return leads.map((l) => ({
        leadId: l.id,
        score: null,
        reason: `AI scoring failed; lead left unscored (${err instanceof Error ? err.message : 'unknown error'}).`,
      }))
    }
  }

  async draftEmail(
    lead: EmailDraftInput,
    promptTemplate: string,
  ): Promise<EmailDraftOutput> {
    const leadContext = `Email: ${lead.email} | Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown'} | Title: ${lead.title ?? 'Unknown'} | Company: ${lead.company ?? 'Unknown'}`

    const systemPrompt = `${promptTemplate}

Write a personalized outbound sales email for the lead below.
Return ONLY a JSON object: { "subject": "<subject line>", "body": "<email body>" }
No markdown, no explanation.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: leadContext },
        ],
        temperature: 0.4,
        response_format: JSON_RESPONSE_FORMAT,
      })

      const content = response.choices[0]?.message.content ?? ''
      const raw = JSON.parse(content) as { subject?: unknown; body?: unknown }
      if (typeof raw.subject !== 'string' || typeof raw.body !== 'string' || raw.body.trim() === '') {
        throw new SyntaxError('Expected non-empty { subject, body } strings')
      }
      return { subject: raw.subject, body: raw.body }
    } catch (err) {
      // SURFACE, never persist a silent empty draft. The caller/route turns this
      // into a clear "draft generation failed, try again" signal.
      throw new DraftGenerationError(
        `AI draft generation failed for ${lead.email}. Please try again.`,
        err,
      )
    }
  }

  async classifyReply(
    input: ReplyClassifyInput,
    promptTemplate: string,
  ): Promise<ReplyClassifyOutput> {
    const VALID: ReplyClassificationValue[] = [
      'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'OUT_OF_OFFICE',
      'UNSUBSCRIBE_REQUEST', 'REFERRAL', 'UNKNOWN',
    ]

    // Append the JSON-object instruction so JSON mode's "must contain 'json'"
    // requirement holds even for custom templates that omit it.
    const systemPrompt = `${promptTemplate}

Return ONLY a JSON object: { "classification": "<CATEGORY>", "confidence": <0.0-1.0> }`

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input.rawBody },
        ],
        temperature: 0.1,
        response_format: JSON_RESPONSE_FORMAT,
      })

      const content = response.choices[0]?.message.content ?? ''
      const raw = JSON.parse(content) as { classification?: unknown; confidence?: unknown }

      if (
        typeof raw.classification !== 'string' ||
        !VALID.includes(raw.classification as ReplyClassificationValue)
      ) {
        throw new SyntaxError(`Invalid classification: ${raw.classification}`)
      }

      const confidence = typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5

      return {
        classification: raw.classification as ReplyClassificationValue,
        confidence,
      }
    } catch (err) {
      // Explicit fallback: UNKNOWN with 0 confidence is a defined "could not
      // classify" state — NOT silent-empty data. We deliberately degrade rather
      // than throw so an inbound reply is still persisted (losing the reply would
      // be worse than leaving it unclassified for manual review).
      console.warn('[OpenAIProvider.classifyReply] classification failed — defaulting to UNKNOWN', err)
      return { classification: 'UNKNOWN', confidence: 0 }
    }
  }
}
