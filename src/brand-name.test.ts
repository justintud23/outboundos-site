import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// The product was renamed from OutboundOS to Outwyn. The old name must not
// reappear anywhere users can see it. Internal storage keys keep the old
// prefix on purpose: renaming them would reset every user's saved settings.
const ALLOWED = [/STORAGE_KEY = 'outboundos[-:]/, /'outboundos:view'/]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx?|css)$/.test(name) && full !== __filename ? [full] : []
  })
}

describe('brand name', () => {
  it('never shows the old OutboundOS name', () => {
    const hits = sourceFiles(path.resolve(__dirname)).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${path.relative(__dirname, file)}:${i + 1}` }))
        .filter(({ line }) => /outbound\s*os/i.test(line) && !ALLOWED.some((re) => re.test(line))),
    )
    expect(hits.map((h) => h.at)).toEqual([])
  })
})
