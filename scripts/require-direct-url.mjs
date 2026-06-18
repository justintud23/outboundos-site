#!/usr/bin/env node
// Build-time guard for `vercel-build`: in a DEPLOY environment, a Prisma
// migration is about to run, and it MUST use Neon's direct (non-pooled)
// connection. Neon's pooler runs PgBouncer in transaction mode, which breaks
// the advisory locks Prisma takes during `migrate deploy` and can intermittently
// corrupt migration state. `prisma.config.ts` resolves the migrate URL as
// `DIRECT_URL ?? DATABASE_URL`, so if DIRECT_URL is missing it would SILENTLY
// fall back to the pooled DATABASE_URL — exactly the dangerous case. This guard
// makes the build fail LOUDLY instead of falling back silently.
//
// Gating (intentionally strict): the guard only enforces when we're actually in
// a deploy build —
//     process.env.VERCEL is set (Vercel sets VERCEL=1 on every build), OR
//     process.env.NODE_ENV === 'production'.
// It does NOT trip in local dev: `npm run dev` and `npm run build` never invoke
// this script (only `vercel-build` does), and a normal local shell has neither
// VERCEL nor NODE_ENV=production set — so a locally-unset DIRECT_URL (where the
// pooled fallback is correct) is fine.

const isDeployEnv =
  Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production'

const directUrl = process.env.DIRECT_URL

if (isDeployEnv && (!directUrl || directUrl.trim() === '')) {
  console.error(
    '\n[require-direct-url] DIRECT_URL must be set for migrations.\n' +
      'Set it in the Vercel project env vars (Production + Preview) to the Neon\n' +
      'DIRECT / non-pooled connection string. Refusing to run `prisma migrate\n' +
      "deploy` against the pooled DATABASE_URL — Neon's pooler breaks Prisma's\n" +
      'migration advisory locks. Failing the build.\n',
  )
  process.exit(1)
}

process.exit(0)
