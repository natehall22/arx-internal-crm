import { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import { loadOnlinePayments, startOnboarding } from '@/lib/online-payments/accounts'

export const dynamic = 'force-dynamic'

/**
 * Stripe's `refresh_url`: an onboarding link expired or was used, so make a fresh one and send the owner straight back
 * into Stripe (https://docs.stripe.com/connect/standard-accounts). Signed-in owners only; anyone else goes to Settings.
 */
export async function GET(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner')
  const origin = new URL(request.url).origin
  if (a.error) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent('/admin#online-payments')}`, 303)
  const base = await orgAppUrl(a.profile.org_id)
  const back = `${base}/admin?payments=error#online-payments`
  const op = await loadOnlinePayments(a.admin, a.profile.org_id)
  if (!op.featureOn || !op.configured) return NextResponse.redirect(back, 303)
  try {
    const { url } = await startOnboarding(a.admin, a.profile.org_id, a.profile.id, {
      returnUrl: `${base}/admin?payments=return#online-payments`,
      refreshUrl: `${base}/api/admin/online-payments/onboarding`,
    })
    return NextResponse.redirect(url, 303)
  } catch (e) {
    console.error('online-payments onboarding refresh failed', e)
    return NextResponse.redirect(back, 303)
  }
}
