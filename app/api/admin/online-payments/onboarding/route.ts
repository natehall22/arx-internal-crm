import { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'

export const dynamic = 'force-dynamic'

/**
 * Stripe's `refresh_url` (an onboarding link expired or was already used). A GET must change nothing (a link on another
 * site could make an owner's browser open it), so this only sends the owner back to Settings → Online payments, where
 * "Finish setup in Stripe" starts a fresh link with a same-site POST (/api/admin/online-payments, action 'connect').
 */
export async function GET(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner')
  const origin = new URL(request.url).origin
  if (a.error) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent('/admin#online-payments')}`, 303)
  const base = await orgAppUrl(a.profile.org_id)
  return NextResponse.redirect(`${base}/admin?payments=resume#online-payments`, 303)
}
