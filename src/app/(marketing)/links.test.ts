import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Guards the public marketing site against dead links: every href in the
// marketing components and pages must point at a route that exists (or at a
// section id on the homepage). A 404 here is what prospects see in a demo.

const APP_DIR = path.resolve(__dirname, '..')
const MARKETING_DIR = path.resolve(__dirname)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

const files = [path.join(APP_DIR, 'page.tsx'), ...sourceFiles(MARKETING_DIR)]
const sources = files.map((f) => ({ file: path.relative(APP_DIR, f), text: readFileSync(f, 'utf8') }))

function hrefsIn(text: string): string[] {
  const out: string[] = []
  const patterns = [/href=["'`]([^"'`]+)["'`]/g, /href:\s*["'`]([^"'`]+)["'`]/g, /href=\{["'`]([^"'`]+)["'`]\}/g]
  for (const re of patterns) for (const m of text.matchAll(re)) if (m[1]) out.push(m[1])
  return out
}

/** Route groups like (marketing) don't appear in the URL. */
function pageExists(urlPath: string): boolean {
  const segments = urlPath.split('/').filter(Boolean)
  const search = (dir: string, rest: string[]): boolean => {
    if (rest.length === 0) {
      if (existsSync(path.join(dir, 'page.tsx'))) return true
    }
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (!statSync(full).isDirectory()) continue
      if (/^\(.+\)$/.test(name) && search(full, rest)) return true
      // Optional catch-all, e.g. sign-in/[[...sign-in]]
      if (rest.length === 0 && /^\[\[\.\.\..+\]\]$/.test(name) && existsSync(path.join(full, 'page.tsx'))) return true
      if (rest[0] === name && search(full, rest.slice(1))) return true
    }
    return false
  }
  return search(APP_DIR, segments)
}

const homepageIds = new Set(
  sources.flatMap(({ text }) => [...text.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1] as string)),
)

const links = sources.flatMap(({ file, text }) => hrefsIn(text).map((href) => ({ file, href })))

describe('marketing site links', () => {
  it('finds links to check', () => {
    expect(links.length).toBeGreaterThan(10)
  })

  it.each(links)('$file → $href resolves', ({ href }) => {
    if (href.startsWith('mailto:') || /^https?:\/\//.test(href)) return
    const [pathname = '/', hash] = href.split('#')
    expect(pageExists(pathname || '/'), `no page for ${pathname}`).toBe(true)
    if (hash) expect(homepageIds.has(hash), `no element with id="${hash}"`).toBe(true)
  })
})
