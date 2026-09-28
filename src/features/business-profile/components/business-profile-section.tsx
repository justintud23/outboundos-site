'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { PRESETS, PRESET_OPTIONS } from '../presets'
import type {
  BusinessProfileDTO,
  ColumnMapping,
  PresetId,
  PropertyTier,
  PropertyTypeRule,
  Yard,
} from '../types'

interface BusinessProfileSectionProps {
  initialProfile: BusinessProfileDTO | null
}

const TEXTAREA_CLASS =
  'w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)] hover:border-[var(--border-glow)]'

const LABEL_CLASS = 'text-[var(--text-secondary)] text-xs font-medium block mb-1'

const TIER_OPTIONS: { value: PropertyTier; label: string }[] = [
  { value: 'great', label: 'Great fit' },
  { value: 'good', label: 'Good fit' },
  { value: 'no_go', label: 'Not a fit' },
]

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string }[] = [
  { key: 'propertyType', label: 'Property type column' },
  { key: 'zip', label: 'ZIP column' },
  { key: 'city', label: 'City column' },
  { key: 'state', label: 'State column' },
  { key: 'sites', label: 'Sites column' },
  { key: 'acres', label: 'Acres column' },
  { key: 'relationship', label: 'Relationship column' },
]

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function splitCommas(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

interface YardRow {
  label: string
  zip: string
  radiusMiles: string
}

interface PropertyTypeRow {
  label: string
  keywords: string
  tier: PropertyTier
}

type ColumnMappingRow = Record<keyof ColumnMapping, string>

function toYardRows(yards: Yard[]): YardRow[] {
  return yards.map((y) => ({ label: y.label, zip: y.zip, radiusMiles: String(y.radiusMiles) }))
}

function toPropertyTypeRows(types: PropertyTypeRule[]): PropertyTypeRow[] {
  return types.map((t) => ({ label: t.label, keywords: t.keywords.join(', '), tier: t.tier }))
}

function toColumnMappingRow(mapping: ColumnMapping): ColumnMappingRow {
  return {
    propertyType: mapping.propertyType ?? '',
    zip: mapping.zip ?? '',
    city: mapping.city ?? '',
    state: mapping.state ?? '',
    sites: mapping.sites ?? '',
    acres: mapping.acres ?? '',
    relationship: mapping.relationship ?? '',
  }
}

export function BusinessProfileSection({ initialProfile }: BusinessProfileSectionProps) {
  const [profile, setProfile] = useState<BusinessProfileDTO | null>(initialProfile)
  const hasServerProfile = initialProfile !== null

  if (!profile) {
    return (
      <PresetPicker
        onContinue={(id) => setProfile(JSON.parse(JSON.stringify(PRESETS[id])) as BusinessProfileDTO)}
      />
    )
  }

  return <ProfileForm initialProfile={profile} hasServerProfile={hasServerProfile} />
}

function PresetPicker({ onContinue }: { onContinue: (id: PresetId) => void }) {
  const [selected, setSelected] = useState<PresetId>(PRESET_OPTIONS[0]?.id ?? 'snow_paving')

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-4 shadow-[var(--shadow-card)]">
      <h2 className="text-[var(--text-primary)] text-sm font-medium">Set up your business profile</h2>
      <p className="text-[var(--text-muted)] text-xs">
        Pick the closest match. You can change everything below before saving.
      </p>
      <div className="space-y-2">
        {PRESET_OPTIONS.map((opt) => (
          <label key={opt.id} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="radio"
              name="preset"
              value={opt.id}
              checked={selected === opt.id}
              onChange={() => setSelected(opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </div>
      <Button type="button" variant="primary" size="sm" onClick={() => onContinue(selected)}>
        Continue
      </Button>
    </div>
  )
}

interface ProfileFormProps {
  initialProfile: BusinessProfileDTO
  hasServerProfile: boolean
}

function ProfileForm({ initialProfile, hasServerProfile }: ProfileFormProps) {
  const preset = initialProfile.preset

  const [companySummary, setCompanySummary] = useState(initialProfile.companySummary)
  const [services, setServices] = useState(initialProfile.services.join('\n'))
  const [yardRows, setYardRows] = useState<YardRow[]>(toYardRows(initialProfile.yards))
  const [alwaysZips, setAlwaysZips] = useState(initialProfile.alwaysZips.join('\n'))
  const [neverZips, setNeverZips] = useState(initialProfile.neverZips.join('\n'))
  const [propertyTypeRows, setPropertyTypeRows] = useState<PropertyTypeRow[]>(
    toPropertyTypeRows(initialProfile.propertyTypes),
  )
  const [decisionTitles, setDecisionTitles] = useState(initialProfile.decisionTitleKeywords.join('\n'))
  const [downrankTitles, setDownrankTitles] = useState(initialProfile.downrankTitleKeywords.join('\n'))
  const [bigSites, setBigSites] = useState(String(initialProfile.bigSites))
  const [bigAcres, setBigAcres] = useState(initialProfile.bigAcres === null ? '' : String(initialProfile.bigAcres))
  const [columnMapping, setColumnMapping] = useState<ColumnMappingRow>(
    toColumnMappingRow(initialProfile.columnMapping),
  )

  const [saving, setSaving] = useState(false)
  const [rescoring, setRescoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [rescoreMessage, setRescoreMessage] = useState<string | null>(null)
  const [canRescore, setCanRescore] = useState(hasServerProfile)

  function applyProfile(saved: BusinessProfileDTO) {
    setCompanySummary(saved.companySummary)
    setServices(saved.services.join('\n'))
    setYardRows(toYardRows(saved.yards))
    setAlwaysZips(saved.alwaysZips.join('\n'))
    setNeverZips(saved.neverZips.join('\n'))
    setPropertyTypeRows(toPropertyTypeRows(saved.propertyTypes))
    setDecisionTitles(saved.decisionTitleKeywords.join('\n'))
    setDownrankTitles(saved.downrankTitleKeywords.join('\n'))
    setBigSites(String(saved.bigSites))
    setBigAcres(saved.bigAcres === null ? '' : String(saved.bigAcres))
    setColumnMapping(toColumnMappingRow(saved.columnMapping))
  }

  function addYard() {
    setYardRows((prev) => (prev.length >= 5 ? prev : [...prev, { label: '', zip: '', radiusMiles: '' }]))
  }
  function removeYard(index: number) {
    setYardRows((prev) => prev.filter((_, i) => i !== index))
  }
  function updateYard(index: number, patch: Partial<YardRow>) {
    setYardRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addPropertyType() {
    setPropertyTypeRows((prev) => [...prev, { label: '', keywords: '', tier: 'good' }])
  }
  function removePropertyType(index: number) {
    setPropertyTypeRows((prev) => prev.filter((_, i) => i !== index))
  }
  function updatePropertyType(index: number, patch: Partial<PropertyTypeRow>) {
    setPropertyTypeRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function buildDTO(): BusinessProfileDTO {
    const mapping: ColumnMapping = {}
    for (const { key } of MAPPING_FIELDS) {
      const value = columnMapping[key].trim()
      if (value) mapping[key] = value
    }
    return {
      preset,
      companySummary,
      services: splitLines(services),
      yards: yardRows.map((y) => ({
        label: y.label.trim(),
        zip: y.zip.trim(),
        radiusMiles: Number(y.radiusMiles),
      })),
      alwaysZips: splitLines(alwaysZips),
      neverZips: splitLines(neverZips),
      propertyTypes: propertyTypeRows.map((t) => ({
        label: t.label.trim(),
        keywords: splitCommas(t.keywords),
        tier: t.tier,
      })),
      decisionTitleKeywords: splitLines(decisionTitles),
      downrankTitleKeywords: splitLines(downrankTitles),
      bigSites: Number(bigSites),
      bigAcres: bigAcres.trim() === '' ? null : Number(bigAcres),
      columnMapping: mapping,
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaveMessage(null)
    setRescoreMessage(null)
    try {
      const res = await fetch('/api/settings/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDTO()),
      })
      const data = (await res.json().catch(() => null)) as { profile?: BusinessProfileDTO; error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Failed to save profile.')
        return
      }
      if (data?.profile) applyProfile(data.profile)
      setCanRescore(true)
      setSaveMessage('Profile saved. Rescore your leads to apply it.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRescore() {
    setRescoring(true)
    setError(null)
    setSaveMessage(null)
    setRescoreMessage(null)
    try {
      let since: string | undefined
      let remaining = 1
      let total = 0
      let previousRemaining: number | undefined
      while (remaining > 0) {
        const res = await fetch('/api/settings/business-profile/rescore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(since ? { since } : {}),
        })
        const data = (await res.json().catch(() => null)) as
          | { rescored?: number; remaining?: number; since?: string; error?: string }
          | null
        if (!res.ok || !data) {
          setError(data?.error ?? 'Failed to rescore leads.')
          return
        }
        const rescoredCount = data.rescored ?? 0
        const newRemaining = data.remaining ?? 0
        if (rescoredCount === 0 && previousRemaining !== undefined && newRemaining === previousRemaining) {
          setError('Rescore stopped making progress — try again later.')
          return
        }
        total += rescoredCount
        previousRemaining = newRemaining
        remaining = newRemaining
        since = data.since
        setRescoreMessage(`Rescored ${total} leads…`)
      }
      setRescoreMessage('All leads rescored.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rescore leads.')
    } finally {
      setRescoring(false)
    }
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--text-primary)] text-sm font-medium">Business profile</h2>
        {canRescore && (
          <Button type="button" variant="outline" size="sm" onClick={handleRescore} disabled={rescoring}>
            {rescoring ? 'Rescoring…' : 'Rescore all leads'}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          {error}
        </p>
      )}
      {rescoreMessage && <p className="text-[var(--text-muted)] text-xs">{rescoreMessage}</p>}
      {saveMessage && <p className="text-[var(--status-success)] text-xs">{saveMessage}</p>}

      <div className="space-y-4">
        <div>
          <label className={LABEL_CLASS} htmlFor="company-summary">
            Company summary
          </label>
          <textarea
            id="company-summary"
            rows={4}
            maxLength={600}
            value={companySummary}
            onChange={(e) => setCompanySummary(e.target.value)}
            className={TEXTAREA_CLASS}
          />
          <p className="text-[var(--text-muted)] text-xs mt-1">{companySummary.length} / 600</p>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="services">
            Services
          </label>
          <textarea
            id="services"
            rows={4}
            placeholder="One per line"
            value={services}
            onChange={(e) => setServices(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div>
          <span className={LABEL_CLASS}>Yards</span>
          <div className="space-y-3">
            {yardRows.map((yard, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className={LABEL_CLASS} htmlFor={`yard-label-${i}`}>
                    Yard name<span className="sr-only"> (yard {i + 1})</span>
                  </label>
                  <Input
                    id={`yard-label-${i}`}
                    value={yard.label}
                    onChange={(e) => updateYard(i, { label: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-[100px]">
                  <label className={LABEL_CLASS} htmlFor={`yard-zip-${i}`}>
                    ZIP<span className="sr-only"> (yard {i + 1})</span>
                  </label>
                  <Input
                    id={`yard-zip-${i}`}
                    value={yard.zip}
                    onChange={(e) => updateYard(i, { zip: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className={LABEL_CLASS} htmlFor={`yard-radius-${i}`}>
                    Radius (miles)<span className="sr-only"> (yard {i + 1})</span>
                  </label>
                  <Input
                    id={`yard-radius-${i}`}
                    type="number"
                    value={yard.radiusMiles}
                    onChange={(e) => updateYard(i, { radiusMiles: e.target.value })}
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removeYard(i)}>
                  Remove yard
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={addYard}
            disabled={yardRows.length >= 5}
          >
            Add yard
          </Button>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="always-zips">
            Always-serve ZIPs
          </label>
          <textarea
            id="always-zips"
            rows={3}
            placeholder="One per line"
            value={alwaysZips}
            onChange={(e) => setAlwaysZips(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="never-zips">
            Never-serve ZIPs
          </label>
          <textarea
            id="never-zips"
            rows={3}
            placeholder="One per line"
            value={neverZips}
            onChange={(e) => setNeverZips(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div>
          <span className={LABEL_CLASS}>Property types</span>
          <div className="space-y-3">
            {propertyTypeRows.map((row, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[120px]">
                  <label className={LABEL_CLASS} htmlFor={`property-name-${i}`}>
                    Name<span className="sr-only"> (property type {i + 1})</span>
                  </label>
                  <Input
                    id={`property-name-${i}`}
                    value={row.label}
                    onChange={(e) => updatePropertyType(i, { label: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <label className={LABEL_CLASS} htmlFor={`property-keywords-${i}`}>
                    Keywords<span className="sr-only"> (property type {i + 1})</span>
                  </label>
                  <Input
                    id={`property-keywords-${i}`}
                    value={row.keywords}
                    onChange={(e) => updatePropertyType(i, { keywords: e.target.value })}
                    placeholder="comma, separated"
                  />
                </div>
                <div className="min-w-[130px]">
                  <label className={LABEL_CLASS} htmlFor={`property-tier-${i}`}>
                    Fit<span className="sr-only"> (property type {i + 1})</span>
                  </label>
                  <Select
                    id={`property-tier-${i}`}
                    className="w-full"
                    value={row.tier}
                    onChange={(e) => updatePropertyType(i, { tier: e.target.value as PropertyTier })}
                  >
                    {TIER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => removePropertyType(i)}>
                  Remove property type
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={addPropertyType}>
            Add property type
          </Button>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="decision-titles">
            Decision-maker titles
          </label>
          <textarea
            id="decision-titles"
            rows={3}
            placeholder="One per line"
            value={decisionTitles}
            onChange={(e) => setDecisionTitles(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="downrank-titles">
            Junior titles
          </label>
          <textarea
            id="downrank-titles"
            rows={3}
            placeholder="One per line"
            value={downrankTitles}
            onChange={(e) => setDownrankTitles(e.target.value)}
            className={TEXTAREA_CLASS}
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[140px]">
            <label className={LABEL_CLASS} htmlFor="big-sites">
              Big customer: sites
            </label>
            <Input id="big-sites" type="number" min={1} value={bigSites} onChange={(e) => setBigSites(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className={LABEL_CLASS} htmlFor="big-acres">
              Big customer: acres
            </label>
            <Input id="big-acres" type="number" min={0} value={bigAcres} onChange={(e) => setBigAcres(e.target.value)} />
          </div>
        </div>

        <details className="border border-[var(--border-default)] rounded-[var(--radius-btn)] p-3">
          <summary className="text-[var(--text-secondary)] text-xs font-medium cursor-pointer">
            Column mapping
          </summary>
          <p className="text-[var(--text-muted)] text-xs mt-2">
            Leave blank to auto-detect columns from your CSV headers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            {MAPPING_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className={LABEL_CLASS} htmlFor={`mapping-${key}`}>
                  {label}
                </label>
                <Input
                  id={`mapping-${key}`}
                  placeholder="auto-detect"
                  value={columnMapping[key]}
                  onChange={(e) => setColumnMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </details>
      </div>

      <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </Button>
    </div>
  )
}
