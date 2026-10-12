/**
 * Founder contacts — realtors, recruits and other people Nathan meets during the day, typed into
 * the founder calendar page and emailed to him each evening as one compiled list.
 *
 * Kept deliberately small: one table (founder_contacts), validated here, written only by
 * /api/founder-week/contacts with the service client; each row records who added it (created_by). Planned referral-partner and recruiting
 * pipelines (docs/CRM_COMPANY_PLAN.md) can import these rows when they exist.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EASTERN_TZ } from '@/lib/eastern-datetime'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

export const FOUNDER_CONTACT_KINDS = ['realtor', 'recruit', 'other'] as const
export type FounderContactKind = (typeof FOUNDER_CONTACT_KINDS)[number]

export const FOUNDER_CONTACT_KIND_LABELS: Record<FounderContactKind, string> = {
  realtor: 'Real estate agent',
  recruit: 'Recruit',
  other: 'Other',
}

const PAGE = 1000
const STAMP_CHUNK = 100
const LIMITS = { name: 120, phone: 40, email: 200, company: 120, notes: 2000 } as const

export type FounderContactInput = {
  kind: FounderContactKind
  name: string
  phone: string | null
  email: string | null
  company: string | null
  notes: string | null
}

export type FounderContactRow = FounderContactInput & {
  id: string
  created_at: string
  emailed_at: string | null
}

function cleanText(value: unknown, max: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('invalid')
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > max) throw new Error('too_long')
  return trimmed
}

/** Validates a page submission. Returns the clean row or an error message safe to show the user. */
export function parseFounderContact(body: unknown): { ok: true; value: FounderContactInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid request' }
  const b = body as Record<string, unknown>
  if (!FOUNDER_CONTACT_KINDS.includes(b.kind as FounderContactKind)) return { ok: false, error: 'Pick realtor, recruit or other' }
  try {
    const name = cleanText(b.name, LIMITS.name)
    if (!name) return { ok: false, error: 'Name is required' }
    const email = cleanText(b.email, LIMITS.email)
    // Loose on purpose: a typo'd email must not cost the whole contact (phone + notes).
    if (email && !/^\S+@\S+$/.test(email)) return { ok: false, error: 'Email looks wrong' }
    return {
      ok: true,
      value: {
        kind: b.kind as FounderContactKind,
        name,
        phone: cleanText(b.phone, LIMITS.phone),
        email,
        company: cleanText(b.company, LIMITS.company),
        notes: cleanText(b.notes, LIMITS.notes),
      },
    }
  } catch {
    return { ok: false, error: 'A field is too long' }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function csvCell(value: string | null): string {
  const v = value ?? ''
  // Leading = + - @ would run as a formula when the CSV is opened in Excel/Sheets. Phone numbers
  // like "+1 704…" are left alone — they can't run as formulas and the apostrophe would show.
  const phoneLike = /^(\+\d|\(|\d)[\d\s().-]*$/.test(v) && v.replace(/\D/g, '').length >= 7
  const safe = !phoneLike && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function easternStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: EASTERN_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** CSV of every contact (newest first) — attached each night so the email is a full backup. */
export function founderContactsCsv(rows: FounderContactRow[]): string {
  const header = ['Added (ET)', 'Type', 'Name', 'Phone', 'Email', 'Company', 'Notes']
  const lines = rows.map((r) =>
    [easternStamp(r.created_at), FOUNDER_CONTACT_KIND_LABELS[r.kind], r.name, r.phone, r.email, r.company, r.notes]
      .map(csvCell)
      .join(',')
  )
  return [header.join(','), ...lines].join('\r\n') + '\r\n'
}

/** Email body for the new (not yet emailed) contacts, grouped realtors → recruits → other. */
export function founderContactsDigestHtml(newRows: FounderContactRow[], totalCount: number, dateLabel: string): string {
  const sections = FOUNDER_CONTACT_KINDS.map((kind) => {
    const rows = newRows.filter((r) => r.kind === kind)
    if (rows.length === 0) return ''
    const items = rows
      .map((r) => {
        const line2 = [r.phone, r.email, r.company].filter(Boolean).map((v) => escapeHtml(v as string)).join(' · ')
        const notes = r.notes ? `<div style="color:#374151;margin-top:4px;white-space:pre-wrap">${escapeHtml(r.notes)}</div>` : ''
        return `<li style="margin:0 0 12px"><strong>${escapeHtml(r.name)}</strong>${line2 ? `<div style="color:#4b5563">${line2}</div>` : ''}${notes}<div style="color:#9ca3af;font-size:12px">${escapeHtml(easternStamp(r.created_at))}</div></li>`
      })
      .join('')
    return `<h3 style="margin:18px 0 8px;font-size:16px;color:#111827">${FOUNDER_CONTACT_KIND_LABELS[kind]}s (${rows.length})</h3><ul style="padding-left:18px;margin:0">${items}</ul>`
  }).join('')
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:640px">
<h2 style="margin:0 0 4px">Contacts added — ${escapeHtml(dateLabel)}</h2>
<p style="margin:0 0 8px;color:#4b5563">${newRows.length} new today. The attached CSV has all ${totalCount} contacts so far — save it or import it.</p>
${sections}
</div>`
}

export type FounderContactsDigestResult = { sent: number; skipped: boolean; reason?: string }

type DigestRow = FounderContactRow & { org_id: string; created_by: string | null }
const COLUMNS = 'id, org_id, created_by, kind, name, phone, email, company, notes, created_at, emailed_at'

async function fetchAllPages(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<DigestRow[]> {
  const out: DigestRow[] = []
  for (let from = 0; ; ) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data || []) as DigestRow[]
    out.push(...page)
    // Advance by what came back; stop only on an empty page (the server may cap below PAGE).
    if (page.length === 0) break
    from += page.length
  }
  return out
}

/** Stamp in chunks so a big backlog never builds an over-long request URL. */
async function stampEmailed(supabase: SupabaseClient, ids: string[], now: Date): Promise<void> {
  for (let i = 0; i < ids.length; i += STAMP_CHUNK) {
    const { error } = await supabase
      .from('founder_contacts')
      .update({ emailed_at: now.toISOString() })
      .in('id', ids.slice(i, i + STAMP_CHUNK))
    if (error) console.error('[founder-contacts] failed to stamp rows', error.message)
  }
}

/**
 * Nightly: each person who added contacts since the last run gets one email about their own —
 * the new ones listed, a CSV of all of theirs attached — then those rows are stamped emailed_at.
 * Safe to re-run: rows are stamped only after their email went out, so a failed night is picked
 * up by the next run and nothing is sent twice.
 */
export async function sendFounderContactsDigests(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<FounderContactsDigestResult> {
  if (!process.env.SMTP_HOST) {
    console.error('[founder-contacts] SMTP_HOST not set — contacts digest not sent')
    return { sent: 0, skipped: true, reason: 'smtp_not_configured' }
  }

  const fresh = await fetchAllPages((from, to) =>
    supabase.from('founder_contacts').select(COLUMNS).is('emailed_at', null).not('created_by', 'is', null)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  )
  if (fresh.length === 0) return { sent: 0, skipped: true, reason: 'nothing_new' }

  const byUser = new Map<string, DigestRow[]>()
  for (const r of fresh) byUser.set(r.created_by as string, [...(byUser.get(r.created_by as string) || []), r])

  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, active')
    .in('id', Array.from(byUser.keys()))
  if (usersError) throw new Error(usersError.message)

  const dateLabel = now.toLocaleDateString('en-US', { timeZone: EASTERN_TZ, weekday: 'long', month: 'long', day: 'numeric' })
  const fileDate = now.toLocaleDateString('en-CA', { timeZone: EASTERN_TZ })
  let sent = 0

  for (const [userId, rows] of Array.from(byUser.entries())) {
    const user = (users || []).find((u: { id: string }) => u.id === userId) as { email: string | null; active: boolean } | undefined
    if (!user?.email || user.active === false) {
      // Nobody to send to (deactivated or no email): mark them handled so they aren't reloaded nightly.
      console.error('[founder-contacts] no active email for user; their contacts are marked handled', userId)
      await stampEmailed(supabase, rows.map((r) => r.id), now)
      continue
    }
    try {
      const all = await fetchAllPages((from, to) =>
        supabase.from('founder_contacts').select(COLUMNS).eq('org_id', rows[0].org_id).eq('created_by', userId)
          .order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
      )
      await getMailTransport().sendMail({
        from: getCrmEmailFrom(),
        to: user.email,
        subject: `ARX contacts — ${rows.length} new (${dateLabel})`,
        html: founderContactsDigestHtml(rows, all.length, dateLabel),
        attachments: [{ filename: `arx-contacts-${fileDate}.csv`, content: founderContactsCsv(all), contentType: 'text/csv' }],
      })
      sent += 1
    } catch (error) {
      // One person's failure must not block everyone else's email; their rows retry tomorrow.
      console.error('[founder-contacts] digest failed for user', userId, error)
      continue
    }

    await stampEmailed(supabase, rows.map((r) => r.id), now)
  }

  return sent > 0 ? { sent, skipped: false } : { sent: 0, skipped: true, reason: 'send_failed' }
}
