import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveReviewRedirectUrl, DEFAULT_GOOGLE_REVIEW_URL } from '@/lib/review-requests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public tracked redirect for post-job review requests. The customer taps
 * /api/r/<token> in their text; we log the click and 302 them to the org's Google
 * review page. Lives under /api (excluded from auth middleware) because the
 * recipient is an unauthenticated homeowner — NOT under /r, which is the public
 * inspection-report share page.
 *
 * The destination is ALWAYS the org's stored (host-allowlisted) review URL —
 * never anything from the request — so this cannot be abused as an open redirect.
 */
export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params?.token
  // Redirects must be absolute; the default is always a safe, valid https URL.
  const fallback = () => NextResponse.redirect(DEFAULT_GOOGLE_REVIEW_URL, 302)

  if (!token || typeof token !== 'string' || token.length < 8 || token.length > 128) {
    return fallback()
  }

  try {
    const supabase = createServiceClient()

    const { data: row } = await supabase
      .from('review_requests')
      .select('id, org_id, clicked_at, click_count')
      .eq('token', token)
      .maybeSingle()

    if (!row) return fallback()

    const { data: org } = await supabase
      .from('orgs')
      .select('settings')
      .eq('id', row.org_id)
      .maybeSingle()

    const target = resolveReviewRedirectUrl(
      (org?.settings as Record<string, unknown> | null)?.google_review_url
    )

    // Best-effort click logging; must never block or fail the redirect.
    // (Link-preview bots in some SMS clients can pre-fetch this, so click_count
    // is a soft signal, not an exact human-click count.)
    try {
      const nowIso = new Date().toISOString()
      await supabase
        .from('review_requests')
        .update({
          clicked_at: row.clicked_at ?? nowIso,
          click_count: (row.click_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq('id', row.id)
    } catch {
      // ignore — redirect the customer regardless
    }

    return NextResponse.redirect(target, 302)
  } catch {
    return fallback()
  }
}
