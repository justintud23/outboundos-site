import { chromium } from 'playwright'

const BASE_URL = 'https://outboundos-site.vercel.app'

const EMAIL = process.env.SCREENSHOT_EMAIL
const PASSWORD = process.env.SCREENSHOT_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error('Set SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD env vars before running.')
  process.exit(1)
}

async function run() {
  // Headed so you can complete 2FA manually
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

  // Step 3: if 2FA is required, wait for user to complete it in the browser window
  if (page.url().includes('/factor-two') || page.url().includes('/sign-in')) {
    console.log('\n2FA required — complete it in the browser window (you have 60 seconds)...')
  }

  // Wait until fully signed in (not on any sign-in page)
  await page.waitForURL((url) => !url.toString().includes('/sign-in'), { timeout: 60000 })
  console.log('Signed in. Current URL:', page.url())

  // ── Capture pages ─────────────────────────────────────────────────────────────
  const routes = [
    { path: '/leads',     file: 'leads.png' },
    { path: '/drafts',    file: 'drafts.png' },
    { path: '/replies',   file: 'replies.png' },
    { path: '/analytics', file: 'analytics.png' },
  ]

  for (const route of routes) {
    console.log(`Capturing ${route.path}...`)
    await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `public/screenshots/${route.file}`, fullPage: true })
    console.log(`  → public/screenshots/${route.file}`)
  }

  await browser.close()
  console.log('Done.')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
