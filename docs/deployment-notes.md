# Deployment Notes

## Local development

PostgreSQL runs via Docker using the included `docker-compose.yml`:

```bash
docker compose up -d        # start
docker compose down         # stop (data preserved)
docker compose down -v      # wipe data
npx prisma migrate deploy   # apply migrations
```

Connection string: `postgresql://postgres:postgres@localhost:5432/outboundos`

---

## Production database

Replace the local Docker database with any managed PostgreSQL provider.
Swap `DATABASE_URL` in your hosting environment's secrets — no code changes required.

| Provider | Notes |
|---|---|
| [Neon](https://neon.tech) | Serverless Postgres, free tier, branching support |
| [Supabase](https://supabase.com) | Postgres + auth + storage, free tier |
| [Railway](https://railway.app) | Simple provisioning, pay-as-you-go |

---

## Deploying to Vercel

OutboundOS is built for Vercel (Next.js App Router, no custom server).

```bash
vercel deploy
```

Set these environment variables in the Vercel project dashboard:

```
DATABASE_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL
NEXT_PUBLIC_CLERK_SIGN_UP_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
OPENAI_API_KEY
OPENAI_MODEL
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
SENDGRID_WEBHOOK_SECRET
NEXT_PUBLIC_APP_URL
```

Run migrations against the production database before promoting:

```bash
DATABASE_URL=<prod-url> npx prisma migrate deploy
```

---

## SendGrid configuration (production)

- **Outbound sending:** add your verified sender domain in SendGrid, set `SENDGRID_FROM_EMAIL`
- **Webhook events:** point SendGrid Event Webhook to `https://<your-domain>/api/webhooks/sendgrid`, set `SENDGRID_WEBHOOK_SECRET` to the signing key
- **Inbound replies:** configure SendGrid Inbound Parse to POST to `https://<your-domain>/api/replies`

---

## Notes

- No custom server required — standard Vercel deployment
- Prisma driver adapter (`@prisma/adapter-pg`) is already configured for edge-compatible runtimes
- Multi-tenant data isolation is enforced at the query layer — a single deployment serves all organizations
