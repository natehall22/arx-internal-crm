/**
 * Consent to be texted (server only) — proof, not a flag. Each grant or revoke is a NEW row in `customer_sms_consent`
 * (never edited, never deleted): who, which number, how, the exact words shown, when. The latest row for a number in a
 * company decides. Opt-outs ALSO live in the one suppression list (customer_message_suppressions, channel 'sms') that the
 * sender checks first; STOP writes both, START clears the suppression and writes a new grant.
 *
 * What counts: a row of status 'granted' for that number (a form checkbox, or staff recording "the customer said OK by
 * phone / in person"), OR the customer texted the company first within CUSTOMER_STARTED_HOURS (a reply to their own
 * question needs no earlier opt-in). Informational texts only: no marketing wording in anything we send (the wording below
 * says what the person agreed to).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { consentText, SMS_CONSENT_WORDING_VERSION } from '@/lib/sms/consent-text'
import { suppressionOf } from '@/lib/customer-message-suppressions'
import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

/** A customer who texts us first can be answered for this long without an earlier opt-in. */
export const CUSTOMER_STARTED_HOURS = 24

export { consentText, SMS_CONSENT_WORDING_VERSION }

export const CONSENT_SOURCES = ['staff_phone', 'staff_in_person', 'portal', 'signing', 'quote_form', 'web_form', 'sms_start', 'sms_stop', 'import'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

export const CONSENT_SOURCE_TEXT: Record<ConsentSource, string> = {
  staff_phone: 'Said OK by phone',
  staff_in_person: 'Said OK in person',
  portal: 'Ticked the box in their customer account',
  signing: 'Ticked the box when signing',
  quote_form: 'Ticked the box on a quote form',
  web_form: 'Ticked the box on a web form',
  sms_start: 'Texted START',
  sms_stop: 'Texted STOP',
  import: 'Brought over from the old system',
}

export type ConsentRow = {
  id: string
  customer_id: string | null
  phone_e164: string
  status: 'granted' | 'revoked'
  source: ConsentSource
  wording_version: string | null
  created_by: string | null
  created_at: string
  evidence: Record<string, unknown>
}
const COLS = 'id, customer_id, phone_e164, status, source, wording_version, created_by, created_at, evidence'

export type ConsentInput = {
  customerId: string | null
  phone: string
  status: 'granted' | 'revoked'
  source: ConsentSource
  /** The company name the wording was shown with (stored with the exact text). */
  companyName?: string
  evidence?: Record<string, unknown>
  createdBy?: string | null
}

const FORM_SOURCES: ReadonlySet<ConsentSource> = new Set(['portal', 'quote_form', 'web_form', 'signing'])

/** Append one consent row. Never edits an earlier one. */
export async function recordConsent(admin: SupabaseClient, orgId: string, c: ConsentInput): Promise<{ ok: true; id: string } | { ok: false; error: string; optedOut?: true }> {
  // A form anyone can fill in never outranks an earlier STOP or "off": only the person's own START or a staff member
  // recording "the customer said OK" (a staff source) after it reopens texting.
  if (c.status === 'granted' && FORM_SOURCES.has(c.source)) {
    const [latest, stopped] = await Promise.all([latestConsent(admin, orgId, c.phone), suppressionOf(admin, orgId, 'sms', c.phone)])
    if (stopped || latest?.status === 'revoked') return { ok: false, error: 'This number asked us to stop texting. Texting it again needs the person to text START.', optedOut: true }
  }
  const { data, error } = await orgDb(admin, orgId)
    .from('customer_sms_consent')
    .insert({
      customer_id: c.customerId,
      phone_e164: c.phone,
      status: c.status,
      source: c.source,
      wording_version: c.status === 'granted' ? SMS_CONSENT_WORDING_VERSION : null,
      wording_text: c.status === 'granted' && c.companyName ? consentText(c.companyName) : null,
      evidence: c.evidence ?? {},
      created_by: c.createdBy ?? null,
    })
    .select('id')
    .single()
  if (error || !data) return { ok: false, error: isMissingTable(error) ? 'The database needs an update before texting can be set up (migration 202611170010).' : 'Could not record that' }
  return { ok: true, id: (data as { id: string }).id }
}

/** The newest consent row for this number in this company (null = none). */
export async function latestConsent(admin: SupabaseClient, orgId: string, phone: string): Promise<ConsentRow | null> {
  const { data, error } = await orgDb(admin, orgId).from('customer_sms_consent').select(COLS).eq('phone_e164', phone).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`consent: ${error.message}`)
  }
  return (data as ConsentRow | null) ?? null
}

/** Did this number text the company within the last CUSTOMER_STARTED_HOURS? (Customer-started conversation.) */
export async function customerTextedRecently(admin: SupabaseClient, orgId: string, phone: string, now: Date, hours = CUSTOMER_STARTED_HOURS): Promise<boolean> {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString()
  const { data, error } = await orgDb(admin, orgId).from('sms_inbound').select('id').eq('from_e164', phone).eq('kind', 'message').gte('received_at', since).limit(1)
  if (error) {
    if (isMissingTable(error)) return false
    throw new Error(`inbound: ${error.message}`)
  }
  return ((data ?? []) as unknown[]).length > 0
}
