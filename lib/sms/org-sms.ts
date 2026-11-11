/**
 * A company's texting setup (server only): its own local number, where its carrier registration stands, and the business
 * details that registration needs. One row per company in `org_sms` (migration 202611170010).
 *
 * The number is how an inbound text finds its company (unique across companies). Until the registration wizard exists a
 * number registered by hand in the carrier's portal is entered by the owner ("Connect your number"); texting only runs
 * while `status = 'active'`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { formatE164, normalizeUsPhone } from '@/lib/sms/phone'
import { isMissingTable } from '@/lib/supabase/errors'
import { orgDb } from '@/lib/supabase/org-db'

export const SMS_STATUSES = ['not_started', 'details_saved', 'brand_pending', 'campaign_pending', 'number_pending', 'active', 'rejected'] as const
export type SmsStatus = (typeof SMS_STATUSES)[number]

export const SMS_STATUS_TEXT: Record<SmsStatus, string> = {
  not_started: 'Not set up yet',
  details_saved: 'Business details saved — waiting for a number',
  brand_pending: 'Registering your business with the carriers',
  campaign_pending: 'Waiting for the carriers to approve your texts',
  number_pending: 'Almost there — your number is being turned on',
  active: 'Ready — texting is on',
  rejected: 'The carriers turned this down',
}

export type OrgSmsRow = {
  org_id: string
  provider: 'telnyx' | 'twilio' | 'test'
  e164: string | null
  number_kind: 'local' | 'toll_free' | 'hosted'
  number_source: 'manual' | 'provider'
  status: SmsStatus
  rejection_reason: string | null
  daily_cap: number
  registration: Record<string, unknown>
  submitted_at: string | null
  approved_at: string | null
}
const COLS = 'org_id, provider, e164, number_kind, number_source, status, rejection_reason, daily_cap, registration, submitted_at, approved_at'

/** Business details a carrier registration asks for (all plain text; the owner fills them in once). */
export const REGISTRATION_FIELDS = [
  { key: 'legalName', label: 'Legal business name', max: 120, required: true, help: 'As it appears on your tax paperwork.' },
  { key: 'ein', label: 'EIN (tax ID)', max: 12, required: true, help: 'Nine digits, like 12-3456789. Carriers need it to approve your number.' },
  { key: 'businessType', label: 'Business type', max: 40, required: true, help: 'LLC, corporation, sole proprietor…' },
  { key: 'website', label: 'Website', max: 200, required: true, help: 'Your public website. Carriers look at it.' },
  { key: 'privacyUrl', label: 'Privacy policy link', max: 300, required: true, help: 'A page on your website that says how you use customer information.' },
  { key: 'termsUrl', label: 'Terms link', max: 300, required: false, help: 'Optional. Your service terms.' },
  { key: 'contactName', label: 'Contact person', max: 80, required: true, help: 'The person carriers can reach about this registration.' },
  { key: 'contactEmail', label: 'Contact email', max: 120, required: true, help: '' },
  { key: 'contactPhone', label: 'Contact phone', max: 30, required: true, help: '' },
  { key: 'useCase', label: 'What you will text about', max: 400, required: true, help: 'Plain words: visit reminders, “on the way” notices, replies to customer questions.' },
  { key: 'optInMethod', label: 'How customers say yes', max: 400, required: true, help: 'For example: they give us their number when they ask for service, and our staff records their OK.' },
] as const
export type RegistrationKey = (typeof REGISTRATION_FIELDS)[number]['key']
export type Registration = Partial<Record<RegistrationKey, string>>

const KEYS = new Set<string>(REGISTRATION_FIELDS.map((f) => f.key))

function plain(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return t.length <= max ? t : null
}

/** A save from the Texting screen → the fields to merge, or a plain-words refusal. */
export function parseRegistrationPatch(body: unknown): { set: Registration } | { error: string } {
  const src = body && typeof body === 'object' && !Array.isArray(body) ? ((body as { registration?: unknown }).registration as Record<string, unknown> | undefined) : undefined
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { error: 'Nothing to save' }
  const set: Registration = {}
  for (const [k, v] of Object.entries(src)) {
    if (!KEYS.has(k)) return { error: `Unknown field: ${k}` }
    const f = REGISTRATION_FIELDS.find((x) => x.key === k)!
    const t = plain(v, f.max)
    if (t === null) return { error: `${f.label}: ${f.max} characters at most` }
    if (k === 'ein' && t && !/^\d{2}-?\d{7}$/.test(t)) return { error: 'EIN: nine digits, like 12-3456789' }
    if ((k === 'website' || k === 'privacyUrl' || k === 'termsUrl') && t && !/^https?:\/\/\S+\.\S+$/i.test(t)) return { error: `${f.label}: start with https://` }
    if (k === 'contactEmail' && t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { error: 'Contact email does not look right' }
    if (k === 'contactPhone' && t && !normalizeUsPhone(t)) return { error: 'Contact phone: a 10-digit US number' }
    set[k as RegistrationKey] = t
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

/** Required fields still blank, as the labels the owner sees. */
export function registrationMissing(reg: Record<string, unknown> | null | undefined): string[] {
  const r = reg ?? {}
  return REGISTRATION_FIELDS.filter((f) => f.required && !(typeof r[f.key] === 'string' && (r[f.key] as string).trim())).map((f) => f.label)
}

/** What the screen may show of the saved details: the EIN is masked (the form never needs to read it back whole). */
export function publicRegistration(reg: Record<string, unknown> | null | undefined): Registration {
  const out: Registration = {}
  for (const f of REGISTRATION_FIELDS) {
    const v = (reg ?? {})[f.key]
    if (typeof v !== 'string' || !v) continue
    out[f.key] = f.key === 'ein' ? `••-•••${v.replace(/\D/g, '').slice(-4)}` : v
  }
  return out
}

/** The company's texting row; null when none (or the migration is not applied yet). */
export async function loadOrgSms(admin: SupabaseClient, orgId: string): Promise<OrgSmsRow | null> {
  const { data, error } = await orgDb(admin, orgId).from('org_sms').select(COLS).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`org sms: ${error.message}`)
  }
  return (data as OrgSmsRow | null) ?? null
}

/** The company that owns this number (an inbound text's `to`, a receipt's `from`), or null. */
export async function findOrgByNumber(admin: SupabaseClient, e164: string): Promise<(OrgSmsRow & { org_id: string }) | null> {
  const n = normalizeUsPhone(e164)
  if (!n) return null
  // org-scope-ok: the lookup that DECIDES the company — by the company's own unique number; every later query is scoped to the org_id it returns
  const { data, error } = await admin.from('org_sms').select(COLS).eq('e164', n).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error(`org sms by number: ${error.message}`)
  }
  return (data as OrgSmsRow | null) ?? null
}

/** Is this company able to send texts right now? Null = yes; otherwise the plain-words reason. */
export function smsNotReadyReason(row: OrgSmsRow | null): string | null {
  if (!row) return 'Your texting number isn’t set up yet (Settings → Texting).'
  if (!row.e164) return 'Your texting number isn’t set up yet (Settings → Texting).'
  if (row.status !== 'active') return `Texting isn’t ready yet: ${(SMS_STATUS_TEXT[row.status] ?? 'not active').toLowerCase()}.`
  return null
}

export async function saveRegistration(admin: SupabaseClient, orgId: string, set: Registration, userId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await loadOrgSms(admin, orgId)
  const merged: Record<string, unknown> = { ...(current?.registration ?? {}), ...set }
  // An empty string clears a field.
  for (const k of Object.keys(merged)) if (merged[k] === '') delete merged[k]
  const status: SmsStatus = current?.status && current.status !== 'not_started' ? current.status : registrationMissing(merged).length === 0 ? 'details_saved' : 'not_started'
  const { error } = await orgDb(admin, orgId)
    .from('org_sms')
    .upsert({ registration: merged, status, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
  if (error) return { ok: false, error: isMissingTable(error) ? 'The database needs an update before texting can be set up (migration 202611170010).' : 'Could not save' }
  return { ok: true }
}

/**
 * "I registered this number with the carrier myself": store it and turn texting on for the company. Owners only (the route
 * checks). The number must be a US number nobody else uses. The first company is set up this way until the registration
 * wizard exists.
 */
export async function connectNumber(admin: SupabaseClient, orgId: string, rawNumber: string, userId: string | null): Promise<{ ok: true; e164: string } | { ok: false; error: string }> {
  const e164 = normalizeUsPhone(rawNumber)
  if (!e164) return { ok: false, error: 'That doesn’t look like a US phone number.' }
  const now = new Date().toISOString()
  const { error } = await orgDb(admin, orgId)
    .from('org_sms')
    .upsert({ e164, number_kind: 'local', number_source: 'manual', status: 'active', approved_at: now, rejection_reason: null, updated_by: userId, updated_at: now }, { onConflict: 'org_id' })
  if (error) {
    if (error.code === '23505') return { ok: false, error: `${formatE164(e164)} is already used by another company.` }
    return { ok: false, error: isMissingTable(error) ? 'The database needs an update before texting can be set up (migration 202611170010).' : 'Could not save' }
  }
  return { ok: true, e164 }
}

/** Turn the number off again (texting stops; nothing is deleted). */
export async function disconnectNumber(admin: SupabaseClient, orgId: string, userId: string | null): Promise<void> {
  await orgDb(admin, orgId).from('org_sms').update({ status: 'not_started', approved_at: null, updated_by: userId, updated_at: new Date().toISOString() }).eq('org_id', orgId)
}
