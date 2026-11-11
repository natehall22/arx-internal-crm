import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { routeDeps } from '@/lib/ai-connector/deps'
import { handleConsent } from '@/lib/ai-connector/endpoints'
import { crossSiteWrite } from '@/lib/online-payments/access'

export const dynamic = 'force-dynamic'

/** POST { ticket, decision: 'allow' | 'deny' } — the signed-in person's answer on the consent screen → { redirect } back to the AI app. */
export async function POST(request: Request) {
  // Browser form only: a request without an Origin, or from another site, is never an approval.
  if (!request.headers.get('origin') || crossSiteWrite(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handleConsent(request, routeDeps(), { userId: profile.id, orgId: profile.org_id })
}
