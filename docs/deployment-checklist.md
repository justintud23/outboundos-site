# OutboundOS Deployment Checklist

Vercel (web) + Neon (PostgreSQL). Estimated time: ~20 minutes.

---

## 1. Provision Neon Database

1. Go to [neon.tech](https://neon.tech) → New Project → name it `outboundos`
2. Copy two connection strings from the dashboard:
   - **Pooled** (for app runtime): `postgresql://...@ep-xxx.pooler.neon.tech/neondb?sslmode=require`
   - **Direct** (for migrations): `postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require`

---

## 2. Run Migrations Against Neon

From your local machine, using the **direct** connection string:

```bash
DATABASE_URL="postgresql://...direct-connection-string..." npx prisma migrate deploy
```

> **Why direct?** Neon's pooler uses PgBouncer in transaction mode, which breaks Prisma's advisory locks during migrations. Always use the direct connection for `migrate deploy`.

Optionally seed demo data:

```bash
DATABASE_URL="postgresql://...direct-connection-string..." npx tsx prisma/seed.ts
```

> Note: `tsx` must be installed locally (`npm install -D tsx`) to run the seed.

---

## 3. Create Vercel Project

1. Go to [vercel.com](https://vercel.com) → New Project → Import `outboundos-site` from GitHub
2. Framework preset: **Next.js** (auto-detected)
3. Build & Output Settings: leave defaults (`next build`)

---

## 4. Set Environment Variables in Vercel

In the Vercel project → Settings → Environment Variables, add all of the following:

### Database
| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |

### Clerk Auth
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Clerk dashboard (production instance) |
| `CLERK_SECRET_KEY` | From Clerk dashboard (production instance) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `/dashboard` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `/dashboard` |

### OpenAI
| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | `sk-...` |
| `OPENAI_MODEL` | `gpt-4o` |

### SendGrid (optional — omit for read-only portfolio demo)
| Variable | Value |
|---|---|
| `SENDGRID_API_KEY` | `SG...` |
| `SENDGRID_FROM_EMAIL` | `outreach@yourdomain.com` |
| `SENDGRID_WEBHOOK_SECRET` | Your webhook secret |

### App
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL (e.g. `https://outboundos.vercel.app`) |

---

## 5. Configure Clerk for Production

1. In Clerk dashboard → create a **Production** instance (separate from development)
2. Add your Vercel domain to **Allowed Origins**
3. Copy the production `PUBLISHABLE_KEY` and `SECRET_KEY` into Vercel env vars

---

## 6. Deploy

Vercel deploys automatically on every push to `main`. To trigger manually:

```bash
git push origin main
```

Or use the Vercel dashboard → Deployments → Redeploy.

**What Vercel runs:**
1. `npm install` → triggers `postinstall: prisma generate` (generates Prisma client)
2. `next build` → compiles the app

---

## 7. Verify

- [ ] Visit your Vercel URL → redirects to sign-in
- [ ] Sign up → creates Clerk account
- [ ] Create an organization in Clerk → `resolveOrganization()` maps it to internal DB org
- [ ] `/campaigns` loads with seeded data
- [ ] `/analytics` shows KPI cards
- [ ] `/drafts` shows draft review flow
- [ ] `/replies` shows reply history

---

## Ongoing Migrations

When you add a new Prisma migration locally:

```bash
# 1. Create migration locally
npx prisma migrate dev --name your-migration-name

# 2. Apply to production (direct connection)
DATABASE_URL="postgresql://...direct..." npx prisma migrate deploy
```

---

## Notes

- `postinstall: "prisma generate"` in `package.json` ensures the client is generated on every Vercel build — no manual step needed
- The `prisma.config.ts` reads `DATABASE_URL` from env — the same var used at runtime
- Neon's free tier includes 0.5 GB storage and auto-suspend after 5 minutes of inactivity (wakes in ~500ms)
