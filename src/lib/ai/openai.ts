import OpenAI from 'openai'
import type { AIProvider, LeadScoreInput, LeadScoreOutput } from './provider'

export class OpenAIProvider implements AIProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey })
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

    const systemPrompt = `${promptTemplate}

Return a JSON array with one object per lead:
[{ "leadId": "<id>", "score": <0-100>, "reason": "<one sentence>" }]

Respond with ONLY the JSON array. No markdown, no explanation.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: leadContext },
        ],
        temperature: 0.2,
      })

      const content = response.choices[0]?.message.content ?? ''
      const raw: unknown = JSON.parse(content)
      if (!Array.isArray(raw)) {
        throw new SyntaxError('Expected JSON array, got: ' + typeof raw)
      }
      return (raw as LeadScoreOutput[]).map((item) => ({
        ...item,
        score: Math.max(0, Math.min(100, item.score)),
      }))
    } catch (err) {
      // Fallback: return 0 score for all leads so import never hard-fails
      return leads.map((l) => ({
        leadId: l.id,
        score: 0,
        reason: `Failed to parse AI response: ${err instanceof Error ? err.message : 'unknown error'}`,
      }))
    }
  }
}
