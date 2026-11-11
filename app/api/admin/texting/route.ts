import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { consentText, SMS_CONSENT_WORDING_VERSION } from '@/lib/sms/consent'
import { connectNumber, disconnectNumber, loadOrgSms, parseRegistrationPatch, publicRegistration, registrationMissing, REGISTRATION_FIELDS, saveRegistration, SMS_STATUS_TEXT, smsNotReadyReason } from '@/lib/sms/org-sms'
import { formatE164 } from '@/lib/sms/phone'
import { getSmsProvider } from '@/lib/sms/provider'
import { monthOf, monthlyUsage, microsToDollars, monthBounds } from '@/lib/sms/usage'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { orgDb } from '@/lib/supabase/org-db'
import { orgTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createServiceClient>

async function auth(): Promise<{ admin: Admin; orgId: string; userId: string } | Response> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isOrgFeatureOn(profile.org_id, 'texting'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperAdmin(profile as never)) return NextResponse.json({ error: 'Only owners can change texting' }, { status: 403 })
  return { admin: createServiceClient(), orgId: profile.org_id, userId: profile.id }
}

/** Everything the Texting screen shows (plain words). */
async function view(admin: Admin, orgId: string) {
  const [row, { data: org }] = await Promise.all([loadOrgSms(admin, orgId), admin.from('orgs').select('name, timezone').eq('id', orgId).maybeSingle()])
  const o = (org ?? {}) as { name?: string | null; timezone?: string | null }
  const tz = orgTimeZone(o.timezone)
  const now = new Date()
  const thisMonth = monthOf(now, tz)
  const lastMonth = monthOf(new Date(monthBounds(thisMonth, tz).start.getTime() - 86_400_000), tz)
  const [usage, previous, inbox] = await Promise.all([
    monthlyUsage(admin, orgId, thisMonth, tz),
    monthlyUsage(admin, orgId, lastMonth, tz),
    orgDb(admin, orgId).from('sms_inbound').select('id, from_e164, body, kind, received_at').eq('status', 'needs_staff').order('received_at', { ascending: false }).limit(20),
  ])
  const provider = getSmsProvider()
  const blockers = [
    ...(provider ? [] : ['No text carrier is set up for this app yet (SMS_PROVIDER and its keys).']),
    ...(provider && !provider.canReceive() ? ['Replies and STOP can’t be received yet: the carrier’s webhook key isn’t set.'] : []),
  ]
  const missing = registrationMissing(row?.registration)
  return {
    companyName: (o.name ?? '').trim(),
    number: row?.e164 ? { e164: row.e164, display: formatE164(row.e164), kind: row.number_kind, source: row.number_source } : null,
    status: row?.status ?? 'not_started',
    statusText: SMS_STATUS_TEXT[row?.status ?? 'not_started'],
    notReady: smsNotReadyReason(row),
    rejectionReason: row?.rejection_reason ?? null,
    dailyCap: row?.daily_cap ?? 300,
    blockers,
    registration: { fields: REGISTRATION_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required, help: f.help, max: f.max })), values: publicRegistration(row?.registration), missing },
    // The wizard that registers the business with the carriers for the company is not built: the button is here, off.
    submit: { enabled: false, note: 'Submitting from here isn’t available yet. Until it is, register your number with the carrier directly, then enter it above.' },
    usage: { thisMonth: { ...usage, cost: microsToDollars(usage.costMicros) }, lastMonth: { ...previous, cost: microsToDollars(previous.costMicros) }, thisMonthLabel: thisMonth, lastMonthLabel: lastMonth },
    consent: { version: SMS_CONSENT_WORDING_VERSION, text: consentText((o.name ?? '').trim()) },
    inbox: ((inbox.data ?? []) as Array<{ id: string; from_e164: string; body: string; kind: string; received_at: string }>).map((m) => ({ id: m.id, from: formatE164(m.from_e164) ?? m.from_e164, body: m.body.slice(0, 300), kind: m.kind, at: m.received_at })),
  }
}

/** GET — owners: the company's texting setup, status, usage and texts waiting for a person. */
export async function GET() {
  const a = await auth()
  if (a instanceof Response) return a
  return NextResponse.json(await view(a.admin, a.orgId))
}

/**
 * PATCH — owners. One of: `{ registration: {...} }` (the business details), `{ connectNumber: '+1…' }` (a number already
 * registered with the carrier), `{ disconnect: true }`, `{ dailyCap: n }`, `{ dismissInbound: id }`.
 */
export async function PATCH(request: Request) {
  const a = await auth()
  if (a instanceof Response) return a
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  if ('registration' in body) {
    const parsed = parseRegistrationPatch(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const r = await saveRegistration(a.admin, a.orgId, parsed.set, a.userId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  } else if (typeof body.connectNumber === 'string') {
    const r = await connectNumber(a.admin, a.orgId, body.connectNumber, a.userId)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  } else if (body.disconnect === true) {
    await disconnectNumber(a.admin, a.orgId, a.userId)
  } else if (typeof body.dailyCap === 'number') {
    if (!Number.isInteger(body.dailyCap) || body.dailyCap < 1 || body.dailyCap > 5000) return NextResponse.json({ error: 'Daily limit: 1 to 5,000 texts' }, { status: 400 })
    const { error } = await orgDb(a.admin, a.orgId).from('org_sms').update({ daily_cap: body.dailyCap, updated_by: a.userId, updated_at: new Date().toISOString() }).eq('org_id', a.orgId)
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  } else if (typeof body.dismissInbound === 'string') {
    const { error } = await orgDb(a.admin, a.orgId)
      .from('sms_inbound')
      .update({ status: 'dismissed', handled_by: a.userId, handled_at: new Date().toISOString() })
      .eq('id', body.dismissInbound)
      .eq('status', 'needs_staff')
    if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
  }
  return NextResponse.json(await view(a.admin, a.orgId))
}
