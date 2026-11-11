import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { channelSender } from '@/lib/customer-message-channels'
import {
  CUSTOMER_MESSAGES_SETTINGS_KEY,
  MESSAGE_KINDS,
  describeMessages,
  parseCustomerMessageSettingsPatch,
  quietHoursPhrase,
  sampleMessages,
} from '@/lib/customer-messages'
import { customerMessagesReady, emailCompanyOf, messageSettingsOf } from '@/lib/customer-messages-db'
import { tryOrgAppUrl } from '@/lib/company-links'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { resolveOrgProfile, t } from '@/lib/org-profile'
import { mergeOrgSettings } from '@/lib/org-settings'
import { ymdInZone } from '@/lib/payroll-week-schedule'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'
import { orgTimeZone } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

type Admin = ReturnType<typeof createServiceClient>

async function auth(): Promise<{ admin: Admin; orgId: string } | Response> {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isOrgFeatureOn(profile.org_id, 'customerMessages'))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isSuperAdmin(profile as never)) return NextResponse.json({ error: 'Only owners can change customer messages' }, { status: 403 })
  return { admin: createServiceClient(), orgId: profile.org_id }
}

/** Everything the Settings screen shows: the switches, what each does in plain words, and a sample of each email. */
async function view(admin: Admin, orgId: string) {
  const { data: org } = await admin.from('orgs').select('id, name, address, phone, email, settings, timezone, logo_url').eq('id', orgId).maybeSingle()
  const o = (org ?? { id: orgId }) as Parameters<typeof emailCompanyOf>[0]
  const settings = messageSettingsOf(o.settings)
  const appUrl = await tryOrgAppUrl(orgId, 'customer-messages settings')
  const company = emailCompanyOf(o, appUrl)
  const today = ymdInZone(new Date(), orgTimeZone(o.timezone))
  const word = t(resolveOrgProfile(o.settings), 'proposal')
  const samples = sampleMessages(company, settings, today, word)
  return {
    settings,
    proposalWord: word,
    describe: describeMessages(settings, word),
    quiet: quietHoursPhrase(settings),
    // What stops anything from going out, in plain words (empty = ready).
    blockers: [
      ...((await customerMessagesReady(admin, orgId)) ? [] : ['The database needs an update before any email can go out (migration 202611120050).']),
      ...(channelSender('email').available() ? [] : ['Email isn’t set up for your company yet (outgoing mail server).']),
      ...(appUrl ? [] : ['Your company’s web address isn’t set up, so emails can’t carry their links yet.']),
      ...(company.addressLine ? [] : ['Add your business address in Settings → Company: the law requires a postal address in these emails.']),
    ],
    samples: Object.fromEntries(MESSAGE_KINDS.map((k) => [k, { subject: samples[k].subject, html: samples[k].html }])),
  }
}

/** GET — owners: the company's customer message settings, plain-word descriptions and previews. */
export async function GET() {
  const a = await auth()
  if (a instanceof Response) return a
  return NextResponse.json(await view(a.admin, a.orgId))
}

/** PATCH { customerMessages: { visitReminder?, visitReminderDays?, … } } — owners. Flat keys, merged. */
export async function PATCH(request: Request) {
  const a = await auth()
  if (a instanceof Response) return a
  const parsed = parseCustomerMessageSettingsPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(a.admin, a.orgId, parsed.set as Record<string, unknown>, { path: [CUSTOMER_MESSAGES_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, ...(await view(a.admin, a.orgId)) })
}
