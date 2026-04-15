import { chromium } from 'playwright'

const BASE_URL = 'https://outboundos-site.vercel.app'

const EMAIL = process.env.SCREENSHOT_EMAIL as string
const PASSWORD = process.env.SCREENSHOT_PASSWORD as string

if (!EMAIL || !PASSWORD) {
  console.error('Set SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD env vars before running.')
  process.exit(1)
}

async function run() {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })

  // ── Sign in ──────────────────────────────────────────────────────────────────
  console.log('Opening sign-in...')
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' })

  // Step 1: email
  await page.fill('input[name="identifier"]', EMAIL)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.waitForTimeout(1500)

  // Step 2: password
  await page.fill('input[type="password"]', PASSWORD)
  await page.getByRole('button', { name: /continue/i }).click()
  await page.waitForTimeout(1500)

  // Step 3: if 2FA is required, wait for user to complete it
  if (page.url().includes('/factor-two') || page.url().includes('/sign-in')) {
    console.log('\n2FA required — complete it in the browser window (you have 60 seconds)...')
  }

  await page.waitForURL((url) => !url.toString().includes('/sign-in'), { timeout: 60000 })
  console.log('Signed in. Current URL:', page.url())

  // ── Helper ────────────────────────────────────────────────────────────────────
  async function capture(path: string, file: string, opts?: { fullPage?: boolean; waitMs?: number }) {
    console.log(`Capturing ${path}...`)
    await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(opts?.waitMs ?? 2500)
    // Hide scrollbar for cleaner screenshots
    await page.addStyleTag({ content: '::-webkit-scrollbar { display: none; } * { scrollbar-width: none; }' })
    await page.screenshot({ path: `public/screenshots/${file}`, fullPage: opts?.fullPage ?? false })
    console.log(`  → public/screenshots/${file}`)
  }

  // ── Capture pages ─────────────────────────────────────────────────────────────

  // 1. Dashboard
  await capture('/dashboard', 'dashboard.png')

  // 2. Action Center
  await capture('/action-center', 'action-center.png')

  // 3. Lead Command Center — find first lead ID from the leads page
  console.log('Finding a lead for Command Center screenshot...')
  await page.goto(`${BASE_URL}/leads`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  // Click first lead link in the table
  const leadLink = page.locator('table tbody tr:first-child td:first-child a').first()
  if (await leadLink.isVisible()) {
    const href = await leadLink.getAttribute('href')
    if (href) {
      await capture(href, 'lead-command-center.png', { waitMs: 3000 })
    } else {
      console.log('  ⚠ Could not find lead link href, skipping Lead Command Center')
    }
  } else {
    console.log('  ⚠ No leads found, skipping Lead Command Center')
  }

  // 4. Inbox
  await capture('/inbox', 'inbox.png')

  // 5. Templates
  await capture('/templates', 'templates.png')

  // 6. Pipeline
  await capture('/pipeline', 'pipeline.png')

  // 7. Analytics
  await capture('/analytics', 'analytics.png')

  // Legacy screenshots (keep backward compat)
  await capture('/leads', 'leads.png')
  await capture('/drafts', 'drafts.png')
  await capture('/replies', 'replies.png')

  await browser.close()
  console.log('\nDone. Screenshots saved to public/screenshots/')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
