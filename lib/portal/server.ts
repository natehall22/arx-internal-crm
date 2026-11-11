/**
 * Customer portal — sign-in and sessions (server only). ONE door for "who is this portal visitor": `getPortalSession()`.
 *
 *  - A customer asks for a link with their email or phone; the link is EMAILED to the address we already have on file
 *    (never to what was typed), so typing someone else's email or number sends nothing to the typist. The answer is the
 *    same whether or not anyone matched, and takes about the same time (no "is this a customer?" oracle).
 *  - The link opens a page that asks for one tap ("Open my account") — only the tap uses the link, so a mail scanner that
 *    previews the URL cannot burn it. Use is atomic (SQL portal_consume_login_token), once, within LOGIN_LINK_MINUTES.
 *  - A session is a random value in a host-only httpOnly cookie (no Domain — it can only go back to the address that set
 *    it), scoped to ONE customer of ONE company, separate from staff sign-in. It is refused on any other company's address,
 *    when the company has the portal off, or when the customer no longer exists.
 *  - Every sign-in, refusal and logout is in portal_login_events (never a token, never a raw address).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

import { orgAppUrl } from '@/lib/company-links'
import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { escapeHtml } from '@/lib/html'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { getDocumentBrand } from '@/lib/org-brand'
import { isWellFormedPortalToken, hashPortalToken, loginLinkExpiry, newPortalToken, opaqueKey, parsePortalIdentifier, PORTAL_COOKIE, sessionExpiry, LOGIN_LINK_MINUTES, SESSION_DAYS } from '@/lib/portal/tokens'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'
import { isUsableCustomerEmail } from '@/lib/invoice-document'
import { orgDb } from '@/lib/supabase/org-db'

export type PortalVia = 'email_link' | 'pay_link' | 'sign_link'
/**
 * `full` = signed in with an emailed link (proof of the customer's own inbox). A session opened from a pay / signing link
 * is LIGHT (full: false): those links get forwarded (to a spouse, a payer), so they never unlock shared documents, photos or
 * the saved card — only what the link's own page could already do, plus the customer's visits, invoices and messages.
 */
export type PortalSession = { sessionId: string; orgId: string; customerId: string; via: PortalVia; full: boolean }

/** What a session may open beyond visits / invoices / messages: documents + photos + card = emailed-link sessions only; contracts also from a signing link. */
export function portalCaps(s: Pick<PortalSession, 'via'>) {
  return { documents: s.via === 'email_link', card: s.via === 'email_link', contracts: s.via === 'email_link' || s.via === 'sign_link' }
}

export type PortalEventKind = 'link_requested' | 'link_sent' | 'link_no_match' | 'link_blocked' | 'login' | 'login_failed' | 'login_via_link' | 'logout'

/** Limits (per window). Every one is a shared SQL counter, so all server instances count together. */
export const PORTAL_LIMITS = {
  requestPerAddress: { limit: 10, windowSeconds: 15 * 60 },
  requestPerIdentifier: { limit: 3, windowSeconds: 60 * 60 },
  requestPerCustomer: { limit: 5, windowSeconds: 60 * 60 },
  enterPerAddress: { limit: 30, windowSeconds: 15 * 60 },
  messagesPerCustomer: { limit: 10, windowSeconds: 60 * 60 },
  payLinksPerCustomer: { limit: 20, windowSeconds: 60 * 60 },
  readsPerSession: { limit: 600, windowSeconds: 10 * 60 },
} as const

/** "May this key try again?" — false = no. A database error is a "no" (fail closed). */
export async function takePortalAttempt(admin: SupabaseClient, key: string, rule: { limit: number; windowSeconds: number }): Promise<boolean> {
  const { data, error } = await admin.rpc('portal_take_attempt', { p_key: key, p_limit: rule.limit, p_window_seconds: rule.windowSeconds })
  if (error) {
    console.error('portal rate limit failed (refusing)', error.message)
    return false
  }
  return data === true
}

export async function logPortalEvent(
  admin: SupabaseClient,
  orgId: string,
  e: { kind: PortalEventKind; customerId?: string | null; via?: string | null; ip?: string | null; detail?: string | null }
): Promise<void> {
  try {
    await orgDb(admin, orgId)
      .from('portal_login_events')
      .insert({ kind: e.kind, customer_id: e.customerId ?? null, via: e.via ?? null, ip_hash: e.ip ? opaqueKey(orgId, e.ip) : null, detail: e.detail ? e.detail.slice(0, 200) : null })
  } catch (err) {
    console.error('portal audit write failed', err)
  }
}

/** The one company this request's address belongs to (host only), or null: the portal exists only on a company's own address. */
export async function portalOrgForRequest(): Promise<string | null> {
  const fence = await getRequestHostFence()
  return fence.kind === 'org' ? fence.orgId : null
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', expires }
}

export function setSessionCookie(res: NextResponse, token: string, expires: Date): void {
  res.cookies.set(PORTAL_COOKIE, token, sessionCookieOptions(expires))
}
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(PORTAL_COOKIE, '', { ...sessionCookieOptions(new Date(0)), maxAge: 0 })
}

/** Start a session for one customer of one company; returns the cookie value. */
export async function startPortalSession(admin: SupabaseClient, orgId: string, customerId: string, via: PortalVia, now: Date = new Date()): Promise<{ token: string; expires: Date }> {
  const token = newPortalToken()
  const expires = sessionExpiry(now)
  const { error } = await orgDb(admin, orgId).from('portal_sessions').insert({ customer_id: customerId, token_hash: hashPortalToken(token), via, expires_at: expires.toISOString() })
  if (error) throw new Error(`Could not start a portal session: ${error.message}`)
  return { token, expires }
}

/**
 * The portal visitor, or null. Checks in order: cookie shape, live session row, the address is this session's company,
 * the company has the portal on, the customer still exists in that company.
 */
export async function getPortalSession(admin: SupabaseClient): Promise<PortalSession | null> {
  let raw: string | undefined
  try {
    raw = cookies().get(PORTAL_COOKIE)?.value
  } catch {
    return null
  }
  if (!isWellFormedPortalToken(raw)) return null
  // org-scope-ok: lookup by the hash of a secret session token — the row it finds names its own company
  const { data } = await admin
    .from('portal_sessions')
    .select('id, org_id, customer_id, via, expires_at, revoked_at, last_seen_at')
    .eq('token_hash', hashPortalToken(raw))
    .maybeSingle()
  const row = data as { id: string; org_id: string; customer_id: string; via: string; expires_at: string; revoked_at: string | null; last_seen_at: string | null } | null
  if (!row || row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null
  if (!fenceAllowsOrg(await getRequestHostFence(), row.org_id)) return null
  if (!(await isOrgFeatureOn(row.org_id, 'customerPortal'))) return null
  const { data: c } = await orgDb(admin, row.org_id).from('customers').select('id').eq('id', row.customer_id).maybeSingle()
  if (!c) return null
  if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 10 * 60_000) {
    await orgDb(admin, row.org_id).from('portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id)
  }
  return { sessionId: row.id, orgId: row.org_id, customerId: row.customer_id, via: row.via as PortalVia, full: row.via === 'email_link' }
}

export async function endPortalSession(admin: SupabaseClient, s: PortalSession, ip?: string | null): Promise<void> {
  await orgDb(admin, s.orgId).from('portal_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', s.sessionId).is('revoked_at', null)
  await logPortalEvent(admin, s.orgId, { kind: 'logout', customerId: s.customerId, ip })
}

/** Use a sign-in link once. Returns the customer it was made for, or null (unknown, used, expired, or another company's address). */
export async function consumeLoginLink(admin: SupabaseClient, token: unknown, hostOrgId: string): Promise<{ orgId: string; customerId: string } | null> {
  if (!isWellFormedPortalToken(token)) return null
  // Peek first so a link opened on another company's address is NOT burned by being tried there.
  // org-scope-ok: lookup by the hash of a secret one-time token — the row it finds names its own company
  const { data: peek } = await admin.from('portal_login_tokens').select('org_id').eq('token_hash', hashPortalToken(token)).maybeSingle()
  if (!peek || (peek as { org_id: string }).org_id !== hostOrgId) return null
  const { data, error } = await admin.rpc('portal_consume_login_token', { p_hash: hashPortalToken(token) })
  if (error) {
    console.error('portal consume failed', error.message)
    return null
  }
  const row = (Array.isArray(data) ? data[0] : data) as { org_id?: string; customer_id?: string } | null
  if (!row?.org_id || !row.customer_id || row.org_id !== hostOrgId) return null
  return { orgId: row.org_id, customerId: row.customer_id }
}

/** Every answer takes this long (default 1.5 s; env PORTAL_REQUEST_MIN_MS for tests): a match (database + email) and a stranger look the same. */
const requestFloorMs = () => {
  const n = Number(process.env.PORTAL_REQUEST_MIN_MS)
  return Number.isFinite(n) && n >= 0 ? n : 1500
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * A customer asked for a link. ALWAYS resolves the same way (the caller shows the same words) and takes the same time:
 * the work races a fixed floor, so a slow mail server cannot tell a stranger from a customer. Mail goes only to the
 * address on file.
 */
export async function requestLoginLink(admin: SupabaseClient, orgId: string, raw: unknown, ip: string): Promise<void> {
  const floor = requestFloorMs()
  const work = doRequest(admin, orgId, raw, ip).catch((e) => console.error('portal link request failed', e))
  await Promise.all([Promise.race([work, sleep(floor)]), sleep(floor)])
}

async function doRequest(admin: SupabaseClient, orgId: string, raw: unknown, ip: string): Promise<void> {
  const id = parsePortalIdentifier(raw)
  await logPortalEvent(admin, orgId, { kind: 'link_requested', via: id?.kind ?? 'unreadable', ip })
  if (!id) return
  if (!(await isOrgFeatureOn(orgId, 'customerPortal'))) return
  const L = PORTAL_LIMITS
  const idKey = id.kind === 'email' ? id.email : id.phone10
  if (!(await takePortalAttempt(admin, `req-ip:${opaqueKey(orgId, ip)}`, L.requestPerAddress)) || !(await takePortalAttempt(admin, `req-id:${opaqueKey(orgId, idKey)}`, L.requestPerIdentifier))) {
    await logPortalEvent(admin, orgId, { kind: 'link_blocked', ip, detail: 'too many requests' })
    return
  }
  const { data: found, error } = await admin.rpc('portal_find_customers', { p_org: orgId, p_email: id.kind === 'email' ? id.email : null, p_phone10: id.kind === 'phone' ? id.phone10 : null })
  if (error) {
    console.error('portal_find_customers failed', error.message)
    return
  }
  const matches = ((found ?? []) as Array<{ id: string; name: string | null; email: string | null }>).filter((m) => isUsableCustomerEmail(m.email))
  if (matches.length === 0) {
    await logPortalEvent(admin, orgId, { kind: 'link_no_match', ip })
    return
  }
  // One email per address on file (a family sharing an address gets one email, one button per person).
  const byEmail = new Map<string, Array<{ id: string; name: string | null }>>()
  for (const m of matches) {
    const to = (m.email as string).trim()
    byEmail.set(to, [...(byEmail.get(to) ?? []), { id: m.id, name: m.name }])
  }
  for (const [to, people] of Array.from(byEmail.entries())) {
    const links: Array<{ name: string; url: string }> = []
    for (const p of people) {
      if (!(await takePortalAttempt(admin, `req-cust:${p.id}`, L.requestPerCustomer))) {
        await logPortalEvent(admin, orgId, { kind: 'link_blocked', customerId: p.id, ip, detail: 'too many for this customer' })
        continue
      }
      const token = newPortalToken()
      const { error: insErr } = await orgDb(admin, orgId)
        .from('portal_login_tokens')
        .insert({ customer_id: p.id, token_hash: hashPortalToken(token), sent_to: to, expires_at: loginLinkExpiry().toISOString() })
      if (insErr) {
        console.error('portal token insert failed', insErr.message)
        continue
      }
      links.push({ name: p.name || 'your account', url: `${await orgAppUrl(orgId)}/portal/enter?t=${token}` })
      await logPortalEvent(admin, orgId, { kind: 'link_sent', customerId: p.id, ip })
    }
    if (links.length) await sendLoginEmail(admin, orgId, to, links)
  }
}

async function sendLoginEmail(admin: SupabaseClient, orgId: string, to: string, links: Array<{ name: string; url: string }>): Promise<void> {
  if (!process.env.SMTP_HOST || !getCrmEmailFrom()) {
    console.error('portal sign-in email not sent: email is not set up for this deployment')
    return
  }
  const brand = await getDocumentBrand(admin, orgId)
  const company = brand.casualName || brand.name
  const one = links.length === 1
  const buttons = links
    .map(
      (l) =>
        `<p style="margin:20px 0;"><a href="${escapeHtml(l.url)}" style="display:inline-block;background:#111827;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">${one ? 'Open my account' : `Open ${escapeHtml(l.name)}’s account`}</a></p>`
    )
    .join('')
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;color:#111827;">
  <div style="font-size:18px;font-weight:700;margin-bottom:12px;">${escapeHtml(brand.name)}</div>
  <p style="font-size:15px;margin:0 0 10px;">Here is your sign-in link for your ${escapeHtml(company)} account.</p>
  ${buttons}
  <p style="font-size:13px;color:#374151;">It works once and expires in ${LOGIN_LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email — nobody can see your account without it.</p>
</div>`
  const text = [`Here is your sign-in link for your ${company} account.`, '', ...links.map((l) => `${l.url}`), '', `It works once and expires in ${LOGIN_LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`].join('\n')
  await getMailTransport().sendMail({ from: getCrmEmailFrom(), to, ...(brand.email ? { replyTo: brand.email } : {}), subject: `Your ${company} account link`, html, text })
}

export { SESSION_DAYS }
