import { describe, it, expect } from 'vitest'
import { PRESETS } from './presets'

describe('PRESETS', () => {
  it('no keyword is a substring of keywords in different tiers', () => {
    for (const [presetId, preset] of Object.entries(PRESETS)) {
      const keywordsByTier = new Map<string, string[]>()

      // Group keywords by tier
      for (const rule of preset.propertyTypes) {
        if (!keywordsByTier.has(rule.tier)) {
          keywordsByTier.set(rule.tier, [])
        }
        keywordsByTier.get(rule.tier)!.push(...rule.keywords)
      }

      // Check that no keyword from one tier is a substring of keywords in other tiers
      for (const [tier1, keywords1] of keywordsByTier.entries()) {
        for (const [tier2, keywords2] of keywordsByTier.entries()) {
          if (tier1 === tier2) continue

          for (const kw1 of keywords1) {
            for (const kw2 of keywords2) {
              expect(kw2.includes(kw1) || kw1.includes(kw2),
                `Preset "${presetId}": keyword "${kw1}" (${tier1}) is a substring of or equal to "${kw2}" (${tier2})`
              ).toBe(false)
            }
          }
        }
      }
    }
  })
})
