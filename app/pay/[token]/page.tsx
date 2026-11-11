import type { Metadata } from 'next'

import { createServiceClient } from '@/lib/supabase/service'
import { loadOnlinePayments } from '@/lib/online-payments/accounts'
import { loadPayPageView, resolvePublicLink } from '@/lib/online-payments/public'
import { fulfillCheckoutSession } from '@/lib/online-payments/record'
import PayClient from '@/components/pay/PayClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Pay online', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/**
 * The customer's pay / save-card page (no login, no Nav, the company's brand only). Coming back from Stripe
 * (`?session_id=`) records the payment right away (Stripe's guidance: fulfil on the landing page too; the webhook is the
 * guarantee and both are idempotent), so the customer sees "Paid" and the office sees it at the same moment.
 */
export default async function PayPage({ params, searchParams }: { params: { token: string }; searchParams: { session_id?: string } }) {
  const admin = createServiceClient()
  const link = await resolvePublicLink(admin, params.token)
  const op = link ? await loadOnlinePayments(admin, link.org_id) : null
  if (link && op?.account && typeof searchParams.session_id === 'string') {
    await fulfillCheckoutSession(admin, op.account, searchParams.session_id).catch((e) => console.error('[pay] landing fulfil failed (webhook will record it)', e))
  }
  const view = link && op ? await loadPayPageView(admin, link, op) : null
  const returned = typeof searchParams.session_id === 'string'
  return <PayClient token={params.token} view={view} returned={returned} />
}
