import { describe, it, expect } from 'vitest'
import { STARTER_SEQUENCES } from './starter-sequences'
import { checkContent } from '@/features/content-check/check-content'

const all = STARTER_SEQUENCES.snow_paving
const words = (body: string) => body.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

describe('snow & paving starter sequences', () => {
  it('has the three sequences with the specified timing', () => {
    expect(all.map((s) => s.name)).toEqual(['Snow — property managers & HOAs', 'Snow — retail & facilities', 'Re-engage past customers & lost quotes'])
    expect(all[0]!.steps.map((s) => s.delayDays)).toEqual([0, 3, 7, 14])
    expect(all[1]!.steps.map((s) => s.delayDays)).toEqual([0, 3, 7, 14])
    expect(all[2]!.steps.map((s) => s.delayDays)).toEqual([0, 5, 12])
    expect(STARTER_SEQUENCES.blank).toEqual([])
  })

  it.each(all.flatMap((s) => s.steps.map((step) => [`${s.name} step ${step.stepNumber}`, step] as const)))('%s passes the copy rules', (_name, step) => {
    const result = checkContent({ subject: step.subject, body: step.body, isFirstStep: step.stepNumber === 1, blockedPhrases: [] })
    expect(result.findings.filter((f) => f.severity !== 'LOW')).toEqual([])
    expect(result.level).toBe('LOW')
    for (const m of `${step.subject}\n${step.body}`.matchAll(/\{([a-zA-Z_]+)(\|[^}]*)?\}/g)) {
      if (m[1] !== 'personalization') expect(m[2], `${m[0]} needs a fallback`).toBeTruthy()
    }
    if (step.stepNumber === 1) {
      expect(step.body).toContain('{personalization}')
      expect(step.personalizationPrompt.length).toBeGreaterThan(20)
    }
    expect(words(step.body)).toBeGreaterThanOrEqual(50)
    expect(words(step.body)).toBeLessThanOrEqual(125)
    expect(step.body).not.toMatch(/https?:\/\/|www\./)
  })
})
