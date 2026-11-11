import { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { requireOnlinePaymentsCaller } from '@/lib/online-payments/access'
import {
  loadLiveAccount,
  loadOnlinePayments,
  markAccountDisconnected,
  publicAccountView,
  refreshAccount,
  saveOnlinePaymentSettings,
  startOnboarding,
} from '@/lib/online-payments/accounts'
import { parseOnlinePaymentSettingsPatch } from '@/lib/online-payments/settings'

export const dynamic = 'force-dynamic'

/** GET — Settings → Online payments: the company's Stripe account status (re-read from Stripe) + settings. Owners. */
export async function GET() {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  let op = await loadOnlinePayments(a.admin, orgId)
  if (op.account && op.configured) {
    try {
      await refreshAccount(a.admin, op.account)
      op = await loadOnlinePayments(a.admin, orgId)
    } catch (e) {
      console.error('online-payments GET: refresh from Stripe failed', e)
    }
  }
  return NextResponse.json(publicAccountView(op))
}

/** POST { action: 'connect' } → { url } (Stripe onboarding, open it in this browser); { action: 'disconnect' }. Owners. */
export async function POST(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const orgId = a.profile.org_id
  const body = (await request.json().catch(() => ({}))) as { action?: string }
  const op = await loadOnlinePayments(a.admin, orgId)
  if (body.action === 'connect') {
    if (!op.featureOn) return NextResponse.json({ error: 'Turn on Online payments in the feature switches first' }, { status: 409 })
    if (!op.configured) return NextResponse.json({ error: 'Online payments are not set up on this server yet (Stripe keys)' }, { status: 503 })
    const base = await orgAppUrl(orgId)
    try {
      const { url } = await startOnboarding(a.admin, orgId, a.profile.id, {
        returnUrl: `${base}/admin?payments=return#online-payments`,
        refreshUrl: `${base}/api/admin/online-payments/onboarding`,
      })
      return NextResponse.json({ url })
    } catch (e) {
      console.error('online-payments connect failed', e)
      return NextResponse.json({ error: 'Stripe did not answer. Please try again in a minute.' }, { status: 502 })
    }
  }
  if (body.action === 'disconnect') {
    const row = await loadLiveAccount(a.admin, orgId)
    if (!row) return NextResponse.json({ error: 'No Stripe account is connected' }, { status: 404 })
    await markAccountDisconnected(a.admin, row, 'Disconnected in the CRM', a.profile.id)
    return NextResponse.json(publicAccountView(await loadOnlinePayments(a.admin, orgId)))
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** PATCH { settings: { allowPartial?, bankPayments?, autopay?, retryDays? } } — owners. */
export async function PATCH(request: Request) {
  const a = await requireOnlinePaymentsCaller('owner')
  if (a.error) return a.error
  const parsed = parseOnlinePaymentSettingsPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await saveOnlinePaymentSettings(a.admin, a.profile.org_id, parsed.set)
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json(publicAccountView(await loadOnlinePayments(a.admin, a.profile.org_id)))
}
