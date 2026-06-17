import { NextResponse } from 'next/server'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { LeadNotFoundError } from '@/features/leads/types'

// Public, no-auth endpoint — the target of the List-Unsubscribe header (RFC 8058).
// Requests come from mail clients (one-click POST) and recipients (GET link
// click), never from logged-in users, so there is no auth/cookie/CSRF check:
// the signed, opaque ?token= IS the authorization.
//
// Responses are deliberately GENERIC and identical whether or not the token was
// valid — we never reveal validity, so the endpoint can't be used to enumerate
// leads/tokens.

const CONFIRMATION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5;">
<h1>You've been unsubscribed</h1>
<p>You will no longer receive emails from this sender. If you reached this page from an old or invalid link, no action was needed.</p>
</body>
</html>`

/**
 * Apply the unsubscribe for a token, if valid. Idempotent and silent: invalid
 * tokens and already-unsubscribed leads are both no-ops. Org scope comes
 * strictly from the token, never from the request.
 */
async function applyUnsubscribe(token: string | null): Promise<void> {
  if (!token) return

  const payload = verifyUnsubscribeToken(token)
  if (!payload) return

  try {
    // `auto:` trigger → never transitions out of a terminal state and is a
    // no-op when the lead is already UNSUBSCRIBED, so repeat hits are
    // idempotent (no duplicate status change / audit row). Moving into the
    // terminal UNSUBSCRIBED status also stops the lead's ACTIVE sequence
    // enrollments (handled inside transitionLeadStatus).
    await transitionLeadStatus({
      organizationId: payload.organizationId,
      leadId: payload.leadId,
      newStatus: 'UNSUBSCRIBED',
      trigger: 'auto:unsubscribe_link',
      metadata: { source: 'unsubscribe_link' },
    })
  } catch (err) {
    if (err instanceof LeadNotFoundError) {
      // Token was authentic but the lead no longer exists (e.g. deleted).
      // Nothing to do — still respond generically.
      return
    }
    throw err
  }
}

function getToken(request: Request): string | null {
  return new URL(request.url).searchParams.get('token')
}

export async function GET(request: Request) {
  try {
    await applyUnsubscribe(getToken(request))
  } catch (err) {
    // Swallow unexpected errors: never surface them (a 500 vs 200 would itself
    // leak signal), and recipients should always see the same confirmation.
    console.error('[GET /api/unsubscribe] error:', err)
  }
  return new NextResponse(CONFIRMATION_HTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(request: Request) {
  // RFC 8058 one-click: mail clients POST `List-Unsubscribe=One-Click` to the
  // List-Unsubscribe URL. We don't need to inspect the body — the token in the
  // query string authorizes the action.
  try {
    await applyUnsubscribe(getToken(request))
  } catch (err) {
    console.error('[POST /api/unsubscribe] error:', err)
  }
  return new NextResponse(null, { status: 200 })
}
