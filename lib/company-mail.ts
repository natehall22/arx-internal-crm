/**
 * Company mail door, part 2 (server only). The shared SMTP login is the original company's mailbox, so another company's mail
 * either gets its From rewritten by Gmail or fails DMARC. When RESEND_API_KEY and COMPANY_MAIL_FROM_DOMAIN are both set, mail
 * for every company that is NOT the original (`orgs.original_brand`) goes out through Resend's HTTP API from
 * `"<Company>" <no-reply@<COMPANY_MAIL_FROM_DOMAIN>>`, replies going to the company's own email. The original company, mail
 * that belongs to no company, a deployment without both env vars, and a deployment where no org is marked original yet stay on
 * SMTP exactly as before. With the env set, a company whose row can't be read is NEVER sent through the shared SMTP login: it throws.
 *
 * It sits INSIDE lib/demo-org-mail.ts (`createGuardedTransport`), so every `getMailTransport(...).sendMail` caller gets it with
 * no edit, and demo / support suppression still runs first.
 */
import addressparser from 'nodemailer/lib/addressparser'

import { pickValidEmail } from '@/lib/email-address'
import { createServiceClient } from '@/lib/supabase/service'

const RESEND_URL = 'https://api.resend.com/emails'
const NAME_MAX = 80
const FETCH_TIMEOUT_MS = 15_000
const MAX_ATTEMPTS = 3
const ORIGINAL_CACHE_MS = 5 * 60_000
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

export type CompanyMailRoute = { apiKey: string; domain: string; companyName: string; companyEmail: string | null }

let warned = false
let originalCache: { at: number; exists: boolean } | null = null
/** Test hook. */
export function resetCompanyMailWarning() {
  warned = false
  originalCache = null
}

/** Pacing + sleep, overridable by tests. Resend allows ~2 requests/s per key. */
export const resendTuning = {
  gapMs: 500,
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
}
let nextSlot = 0
async function awaitSlot() {
  const start = Math.max(Date.now(), nextSlot)
  nextSlot = start + resendTuning.gapMs
  const wait = start - Date.now()
  if (wait > 0) await resendTuning.sleep(wait)
}

function warnOnce(text: string) {
  if (warned) return
  warned = true
  console.warn(text)
}

function cleanDomain(raw: string | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
}

/** Display name safe for a From header: no quotes, backslashes, angle brackets, CR/LF or other control characters; capped. */
export function sanitizeDisplayName(name: unknown): string {
  return String(name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim()
}

/** `"Name" <no-reply@domain>`; the bare address when the name is blank after cleaning. */
export function companyFromHeader(name: unknown, domain: string): string {
  const clean = sanitizeDisplayName(name)
  const address = `no-reply@${domain}`
  return clean ? `"${clean}" <${address}>` : address
}

export function validEmailOrNull(v: unknown): string | null {
  const s = pickValidEmail(typeof v === 'string' ? v : null)
  return s && EMAIL_RE.test(s) ? s : null
}

async function withOneRetry<T>(fn: () => PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  let last: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await fn()
      if (!error) return data
      last = error
    } catch (e) {
      last = e
    }
  }
  throw new Error(`company mail: could not read the company row (${last instanceof Error ? last.message : String((last as { message?: unknown })?.message ?? last)})`)
}

/** Is any org marked the original company? Cached 5 min; a failed read is never cached (it throws). */
async function someOrgIsOriginal(): Promise<boolean> {
  if (originalCache && Date.now() - originalCache.at < ORIGINAL_CACHE_MS) return originalCache.exists
  const rows = await withOneRetry(() => createServiceClient().from('orgs').select('id').eq('original_brand', true).limit(1) as unknown as PromiseLike<{ data: unknown[] | null; error: unknown }>)
  const exists = Array.isArray(rows) && rows.length > 0
  originalCache = { at: Date.now(), exists }
  return exists
}

/**
 * Where this company's mail goes. null = the existing SMTP path: no company, env incomplete, no org marked original yet
 * (deploy-order safety for the original company), or this row IS the original company. With the env set, a company that is
 * not readable (after one retry) THROWS — it must never fall back to the original company's mailbox.
 */
export async function resolveCompanyMailRoute(orgId: string | null | undefined): Promise<CompanyMailRoute | null> {
  if (!orgId) return null
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const domain = cleanDomain(process.env.COMPANY_MAIL_FROM_DOMAIN)
  if (!apiKey || !domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    warnOnce('company mail: RESEND_API_KEY and COMPANY_MAIL_FROM_DOMAIN are not both set; other companies still send through the shared SMTP login (see docs/company-mail-setup.md)')
    return null
  }
  if (!(await someOrgIsOriginal())) {
    warnOnce('company mail: no org is marked original_brand yet; every company stays on the shared SMTP login until one is')
    return null
  }
  const org = await withOneRetry(
    () => createServiceClient().from('orgs').select('name, email, original_brand').eq('id', orgId).maybeSingle() as unknown as PromiseLike<{ data: { name?: unknown; email?: unknown; original_brand?: unknown } | null; error: unknown }>,
  )
  if (!org) throw new Error('company mail: company row not found; not sending under the shared mailbox')
  if (org.original_brand === true) return null
  if (org.original_brand !== false) throw new Error('company mail: company original_brand flag unreadable; not sending under the shared mailbox')
  return { apiKey, domain, companyName: String(org.name ?? ''), companyEmail: validEmailOrNull(org.email) }
}

type Parsed = { name: string; address: string }
/** Every mailbox in a nodemailer address value: "Name <a@b>", "a@b, c@d", quoted commas ("Smith, John" <j@x>), arrays, {name,address}. */
export function parseAddresses(v: unknown): Parsed[] {
  const out: Parsed[] = []
  const walkParsed = (items: Array<{ name?: string; address?: string; group?: unknown[] }>) => {
    for (const it of items) {
      if (Array.isArray(it.group)) walkParsed(it.group as typeof items)
      else if (it.address && EMAIL_RE.test(it.address)) out.push({ name: sanitizeDisplayName(it.name), address: it.address })
    }
  }
  const walk = (x: unknown) => {
    if (!x) return
    if (typeof x === 'string') walkParsed(addressparser(x) as Array<{ name?: string; address?: string; group?: unknown[] }>)
    else if (Array.isArray(x)) x.forEach(walk)
    else if (typeof x === 'object' && typeof (x as { address?: unknown }).address === 'string') {
      const a = x as { name?: unknown; address: string }
      if (EMAIL_RE.test(a.address.trim())) out.push({ name: sanitizeDisplayName(a.name), address: a.address.trim() })
    }
  }
  walk(v)
  return out
}
const formatParsed = (p: Parsed) => (p.name ? `"${p.name}" <${p.address}>` : p.address)

function oneHeaderValue(v: unknown): string {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
}

type MailAttachment = { filename?: string; content?: unknown; contentType?: string; encoding?: string; cid?: string; path?: unknown; href?: unknown }
function toAttachment(a: MailAttachment): Record<string, string> {
  if (!a || typeof a !== 'object' || a.path || a.href) throw new Error('company mail: attachment must carry its own content (no path / href)')
  const raw = a.content
  let content: string
  if (Buffer.isBuffer(raw)) content = raw.toString('base64')
  else if (typeof raw === 'string') content = a.encoding === 'base64' ? raw : Buffer.from(raw, 'utf8').toString('base64')
  else throw new Error('company mail: attachment content must be a Buffer or string')
  return {
    filename: oneHeaderValue(a.filename) || 'attachment',
    content,
    ...(a.contentType ? { content_type: oneHeaderValue(a.contentType) } : {}),
    ...(a.cid ? { content_id: oneHeaderValue(a.cid) } : {}),
  }
}

const RESERVED_HEADERS = /^(from|to|cc|bcc|reply-to|subject|content-type|mime-version|content-transfer-encoding)$/i
function headerValueOf(v: unknown): string {
  if (Array.isArray(v)) return v.map(headerValueOf).filter(Boolean).join(', ')
  if (v && typeof v === 'object' && 'value' in (v as object)) return headerValueOf((v as { value: unknown }).value)
  return oneHeaderValue(v)
}
function collectHeaders(h: unknown, into: Record<string, string>) {
  if (!h) return
  const add = (k: unknown, v: unknown) => {
    const key = String(k ?? '')
    if (!/^[A-Za-z0-9-]+$/.test(key) || RESERVED_HEADERS.test(key)) return
    const val = headerValueOf(v)
    if (val) into[key] = val
  }
  if (Array.isArray(h)) h.forEach((it) => it && typeof it === 'object' && add((it as { key?: unknown }).key, (it as { value?: unknown }).value))
  else if (typeof h === 'object') for (const [k, v] of Object.entries(h as Record<string, unknown>)) add(k, v)
}
const angled = (id: string) => {
  const t = oneHeaderValue(id).replace(/^<|>$/g, '')
  return t ? `<${t}>` : ''
}

/** The Resend request body for one nodemailer-shaped message. Pure. Throws on an attachment it cannot carry. */
export function buildResendPayload(route: CompanyMailRoute, message: Record<string, any>): Record<string, unknown> {
  const replies = parseAddresses(message.replyTo).map((p) => p.address)
  const replyTo = replies.length ? replies : route.companyEmail ? [route.companyEmail] : []
  const headers: Record<string, string> = {}
  collectHeaders(message.headers, headers)
  if (typeof message.messageId === 'string' && message.messageId.trim()) headers['Message-ID'] = angled(message.messageId)
  if (message.inReplyTo) headers['In-Reply-To'] = angled(String(message.inReplyTo))
  if (message.references) {
    const refs = (Array.isArray(message.references) ? message.references : String(message.references).split(/\s+/)).map((r: unknown) => angled(String(r))).filter(Boolean)
    if (refs.length) headers.References = refs.join(' ')
  }
  const to = parseAddresses(message.to).map(formatParsed)
  const cc = parseAddresses(message.cc).map(formatParsed)
  const bcc = parseAddresses(message.bcc).map(formatParsed)
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(toAttachment) : []
  return {
    from: companyFromHeader(route.companyName, route.domain),
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(replyTo.length ? { reply_to: replyTo.length === 1 ? replyTo[0] : replyTo } : {}),
    subject: oneHeaderValue(message.subject),
    ...(message.html ? { html: String(message.html) } : {}),
    ...(message.text ? { text: String(message.text) } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(attachments.length ? { attachments } : {}),
  }
}

/** A network error or timeout: the outcome is unknown (Resend may have accepted it). Shaped like the socket errors isUnknownSmtpOutcome reads. */
function unknownOutcome(e: unknown): Error & { code: string } {
  const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
  const err = new Error(`Resend request ${timedOut ? 'timed out' : 'failed'}: ${e instanceof Error ? e.message.slice(0, 150) : 'network error'}`) as Error & { code: string }
  err.code = timedOut ? 'ETIMEDOUT' : 'ECONNRESET'
  return err
}

function retryDelayMs(res: Response, attempt: number): number {
  const ra = Number(res.headers?.get?.('retry-after'))
  const base = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500 * attempt
  return Math.min(base, 5000)
}

/**
 * Sends one message through Resend; throws on any failure (callers already handle a thrown SMTP error). 15 s per request, paced to
 * ~2 requests/s per process, a 429 is retried (Retry-After honored, capped 5 s) up to 3 attempts. The caller's messageId is also
 * the Idempotency-Key, so a retried request can't deliver twice. Network errors / timeouts are NOT retried and carry an
 * ETIMEDOUT / ECONNRESET code: an unknown outcome, like a dropped SMTP socket.
 */
export async function sendViaResend(route: CompanyMailRoute, message: Record<string, any>): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
  const payload = buildResendPayload(route, message)
  const to = payload.to as string[]
  if (to.length === 0) throw new Error('company mail: no valid recipient')
  const idem = typeof message.messageId === 'string' ? message.messageId.replace(/[<>\s]/g, '').slice(0, 256) : ''
  const requestHeaders: Record<string, string> = { Authorization: `Bearer ${route.apiKey}`, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) }
  const body = JSON.stringify(payload)
  for (let attempt = 1; ; attempt++) {
    await awaitSlot()
    let res: Response
    try {
      res = await fetch(RESEND_URL, { method: 'POST', headers: requestHeaders, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch (e) {
      throw unknownOutcome(e)
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
    if (res.ok) return { messageId: String(json.id ?? ''), accepted: to, rejected: [], response: 'resend' }
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      await resendTuning.sleep(retryDelayMs(res, attempt))
      continue
    }
    const err = new Error(`Resend ${res.status}: ${String(json.message ?? json.name ?? 'send failed').slice(0, 200)}`) as Error & { resendStatus?: number }
    err.resendStatus = res.status
    throw err
  }
}
