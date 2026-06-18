# OutboundOS Deployment Checklist

Vercel (web) + Neon (PostgreSQL). Estimated time: ~20 minutes.

---

## 1. Provision Neon Database

1. Go to [neon.tech](https://neon.tech) → New Project → name it `outboundos`
2. Copy two connection strings from the dashboard:
   - **Pooled** (for app runtime): `postgresql://...@ep-xxx.pooler.neon.tech/neondb?sslmode=require`
   - **Direct** (for migrations): `postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require`

---

## 2. Migrations (applied automatically on deploy)

**You normally do not run migrations by hand.** Every Vercel deploy runs the
`vercel-build` script, which applies pending migrations before building:

```
postinstall (prisma generate) → require-direct-url guard → prisma migrate deploy → next build
```

Your only responsibility is to set `DIRECT_URL` in the Vercel env (see step 4).
`prisma.config.ts` points `migrate` at `DIRECT_URL`, and the guard **fails the
build** if `DIRECT_URL` is missing in a deploy env — it never silently falls
back to the pooled `DATABASE_URL`.

> **Why direct?** Neon's pooler uses PgBouncer in transaction mode, which breaks Prisma's advisory locks during migrations. Migrations must always use the direct (non-pooled) connection — never the pooled URL.

### Manual emergency fallback

If you ever need to apply migrations by hand (e.g. backfilling an existing DB
before the first `vercel-build`, or recovering from a failed deploy), set both
connection strings and run migrate directly — it picks up `DIRECT_URL` via
`prisma.config.ts`:

```bash
DATABASE_URL="postgresql://...pooled..."   # app runtime (migrate ignores this)
DIRECT_URL="postgresql://...direct..."     # migrate uses this
npx prisma migrate deploy
```

Optionally seed demo data (the seed script connects with `DATABASE_URL`):

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
| `DATABASE_URL` | Neon **pooled** connection string (app runtime) |
| `DIRECT_URL` | Neon **direct** (non-pooled) connection string (migrations). **Required — set for both Production AND Preview.** `vercel-build` runs `prisma migrate deploy` using this; if it is missing the build fails fast (by design). |

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

**What Vercel runs** (Vercel uses the `vercel-build` script when present, instead of `build`):
1. `npm install` → triggers `postinstall: prisma generate` (generates Prisma client)
2. `vercel-build`:
   1. `node scripts/require-direct-url.mjs` → fails the build if `DIRECT_URL` is unset in the deploy env
   2. `prisma migrate deploy` → applies pending migrations via the direct connection
   3. `next build` → compiles the app

Because these are chained with `&&`, a failed guard or a failed/partial
migration aborts the build — `next build` never runs on a bad migration.

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

When you add a new Prisma migration, create it locally and commit it:

```bash
npx prisma migrate dev --name your-migration-name
```

On the next push, Vercel's `vercel-build` runs `prisma migrate deploy`
automatically against the direct connection — **no manual production step**. Just
ensure the migration file is committed and `DIRECT_URL` is set in Vercel.

> CI (`.github/workflows/ci.yml`) runs lint / typecheck / tests only — it does
> **not** run `build` or `vercel-build`, so it never touches a database and stays
> green without one. Migrations are exercised only by a real Vercel deploy.

---

## Notes

- `postinstall: "prisma generate"` in `package.json` ensures the client is generated on every Vercel build — no manual step needed
- `prisma.config.ts` resolves the CLI/migrate connection to `DIRECT_URL` (falling back to `DATABASE_URL`); the app runtime connects separately via `@prisma/adapter-pg` using the pooled `DATABASE_URL`
- Neon's free tier includes 0.5 GB storage and auto-suspend after 5 minutes of inactivity (wakes in ~500ms)
