/**
 * "May we text this person right now?" — the rules in ONE place (server only), used by the sender (every automatic text
 * and every staff text goes through `deliver`, which asks `checkSmsRecipient`), by the Customer File / thread screens
 * (`textStatus`, so a button never offers what the server would refuse), and by the thread route before it posts.
 *
 *   company:   `texting` switch on · a number that is `active` · a carrier configured
 *   recipient: not "don't message" in the office · a US number · not on the opt-out list (STOP / bad number)
 *              · consent on file for THAT number, or the customer texted first in the last 24 hours (a staff reply only, never an automatic text)
 *   time:      never before 8 AM or from 9 PM, company time (a hard floor), and inside the company's own quiet hours
 *              (default 8 AM–8 PM). A staff reply to a customer who texted in the last 2 hours may go after the company's quiet hours but never outside 8 AM–9 PM. The customer's own time zone (area code) counts too: the stricter window wins.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { suppressionOf } from '@/lib/customer-message-suppressions'
import { hourInZone, isQuietHour, type CustomerMessageSettings } from '@/lib/customer-messages'
import { areaCodeTimeZone } from '@/lib/sms/area-code-tz'
import { loadOrgFeatures } from '@/lib/org-features'
import { customerTextedRecently, latestConsent } from '@/lib/sms/consent'
import { loadOrgSms, smsNotReadyReason } from '@/lib/sms/org-sms'
import { maskE164, normalizeUsPhone } from '@/lib/sms/phone'
import { getSmsProvider } from '@/lib/sms/provider'
import { isMissingColumn } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'
import { orgTimeZone } from '@/lib/timezone'

/** No text before this hour, ever (company time). */
export const SMS_EARLIEST_HOUR = 8
/** No text from this hour on, ever, whatever the owner chose (the federal 9 PM limit). */
export const SMS_LATEST_HOUR = 21
/** A reply to a customer's own text, within this long, may go after the company's quiet hours (never outside 8 AM–9 PM). */
export const CONVERSATION_WINDOW_HOURS = 2
/** Automatic texts to one number in 24 hours (the shared claim counts them). */
export const SMS_MAX_PER_NUMBER_PER_DAY = 3
/** A staff member's 1:1 replies are a conversation, not automation: a much higher ceiling. */
export const SMS_MAX_STAFF_PER_NUMBER_PER_DAY = 30

/**
 * The time zones a text to this number must be fit for: the company's, plus the number's own (area code, best guess).
 * Both must allow it — the stricter window wins when the two differ or we are unsure.
 */
export function smsZones(companyTimeZone: string, phone: string | null): string[] {
  const theirs = areaCodeTimeZone(phone)
  return theirs && theirs !== companyTimeZone ? [companyTimeZone, theirs] : [companyTimeZone]
}

/** Is it a hour no text may go out in this zone at all (before 8 AM / from 9 PM)? */
export const outsideSmsFloor = (hour: number): boolean => hour < SMS_EARLIEST_HOUR || hour >= SMS_LATEST_HOUR

/** Is this hour closed for texts? The company's own quiet hours, plus the fixed floor. */
export function isSmsQuietHour(hour: number, s: Pick<CustomerMessageSettings, 'quietStart' | 'quietEnd'>): boolean {
  return hour < SMS_EARLIEST_HOUR || hour >= SMS_LATEST_HOUR || isQuietHour(hour, s)
}

export type TextBlock =
  | 'texting_off'
  | 'not_ready'
  | 'no_phone'
  | 'bad_phone'
  | 'customer_off'
  | 'opted_out'
  | 'bad_number'
  | 'no_consent'

export const TEXT_BLOCK_TEXT: Record<TextBlock, string> = {
  texting_off: 'Texting is off for your company.',
  not_ready: 'Your company’s texting number isn’t ready yet (Settings → Texting).',
  no_phone: 'This customer has no phone number on file.',
  bad_phone: 'The phone number on file isn’t one we can text (it must be a US number).',
  customer_off: 'Messages are turned off for this customer.',
  opted_out: 'This customer replied STOP. Only they can turn texts back on: ask them to reply START.',
  bad_number: 'That number can’t get texts (a landline or a number that no longer works).',
  no_consent: 'We don’t have this customer’s OK to text yet.',
}

export type RecipientCheck = { ok: true; via: 'consent' | 'customer_started' } | { ok: false; code: TextBlock }

/** Recipient rules for one number: office flag, opt-out list, consent. (Company readiness and the clock are separate.) */
export async function checkSmsRecipient(
  admin: SupabaseClient,
  orgId: string,
  phone: string,
  now: Date,
  opts: { customerOff?: boolean; /** A staff member's own reply: a customer who texted first may be answered without an earlier OK. */ reply?: boolean } = {}
): Promise<RecipientCheck> {
  if (opts.customerOff) return { ok: false, code: 'customer_off' }
  const sup = await suppressionOf(admin, orgId, 'sms', phone)
  if (sup) return { ok: false, code: sup.reason === 'bounced' ? 'bad_number' : 'opted_out' }
  const consent = await latestConsent(admin, orgId, phone)
  // A revoked row is the newest word: only a fresh grant (or the customer texting START, which writes one) lifts it.
  if (consent?.status === 'granted') return { ok: true, via: 'consent' }
  // The customer texting first lets a PERSON answer them. It never opens automatic texts (reminders, follow-ups).
  if (opts.reply && consent?.status !== 'revoked' && (await customerTextedRecently(admin, orgId, phone, now))) return { ok: true, via: 'customer_started' }
  return { ok: false, code: 'no_consent' }
}

/** Did this number text us within the conversation window (a staff reply may then go at any hour)? */
export function inConversation(admin: SupabaseClient, orgId: string, phone: string, now: Date): Promise<boolean> {
  return customerTextedRecently(admin, orgId, phone, now, CONVERSATION_WINDOW_HOURS)
}

type CustomerRow = { id: string; name: string | null; phone: string | null; messages_off_at: string | null }

async function loadTextCustomer(admin: SupabaseClient, orgId: string, customerId: string): Promise<CustomerRow | null> {
  const { data, error } = await orgDb(admin, orgId).from('customers').select('id, name, phone, messages_off_at').eq('id', customerId).maybeSingle()
  if (error && isMissingColumn(error, 'messages_off_at')) {
    const again = await orgDb(admin, orgId).from('customers').select('id, name, phone').eq('id', customerId).maybeSingle()
    return again.data ? { ...(again.data as Omit<CustomerRow, 'messages_off_at'>), messages_off_at: null } : null
  }
  return (data as CustomerRow | null) ?? null
}

export type TextStatus =
  | { state: 'ready'; phone: string; masked: string; via: 'consent' | 'customer_started'; name: string | null }
  | { state: 'blocked'; code: TextBlock; message: string; phone: string | null; masked: string | null; name: string | null; /** Staff may record the customer's OK (the only thing in their power). */ canRecordConsent: boolean }

/**
 * What a screen needs to know about texting one customer: ready, or the plain-words reason not (and whether recording "the
 * customer said OK" would fix it). Never throws for a missing table (reads as "not ready").
 */
export async function textStatus(admin: SupabaseClient, orgId: string, customerId: string, now: Date = new Date()): Promise<TextStatus> {
  const blocked = (code: TextBlock, phone: string | null, name: string | null): TextStatus => ({
    state: 'blocked',
    code,
    message: TEXT_BLOCK_TEXT[code],
    phone,
    masked: maskE164(phone),
    name,
    canRecordConsent: code === 'no_consent',
  })
  const features = await loadOrgFeatures(admin, orgId)
  if (!features.texting) return blocked('texting_off', null, null)
  const customer = await loadTextCustomer(admin, orgId, customerId)
  if (!customer) return blocked('no_phone', null, null)
  const notReady = smsNotReadyReason(await loadOrgSms(admin, orgId))
  const provider = getSmsProvider()
  if (notReady || !provider?.canSend()) return blocked('not_ready', null, customer.name)
  if (!customer.phone?.trim()) return blocked('no_phone', null, customer.name)
  const phone = normalizeUsPhone(customer.phone)
  if (!phone) return blocked('bad_phone', null, customer.name)
  const check = await checkSmsRecipient(admin, orgId, phone, now, { customerOff: !!customer.messages_off_at, reply: true })
  if (!check.ok) return blocked(check.code, phone, customer.name)
  return { state: 'ready', phone, masked: maskE164(phone) ?? phone, via: check.via, name: customer.name }
}

/** The company's current hour (for the quiet-hours check), from its time-zone setting. */
export async function companyHour(admin: SupabaseClient, orgId: string, now: Date): Promise<{ hour: number; timeZone: string }> {
  const { data } = await admin.from('orgs').select('timezone').eq('id', orgId).maybeSingle()
  const timeZone = orgTimeZone((data as { timezone?: string | null } | null)?.timezone)
  return { hour: hourInZone(now, timeZone), timeZone }
}
