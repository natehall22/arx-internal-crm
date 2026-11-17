/**
 * Company mail door, part 2 (server only). The shared SMTP login is the original company's mailbox, so another company's mail
 * either gets its From rewritten by Gmail or fails DMARC. When RESEND_API_KEY and COMPANY_MAIL_FROM_DOMAIN are both set, mail
 * for every company that is NOT the original (`orgs.original_brand`) goes out through Resend's HTTP API from
 * `"<Company>" <no-reply@<COMPANY_MAIL_FROM_DOMAIN>>`, replies going to the company's own email. The original company, mail
 * that belongs to no company, and a deployment without both env vars stay on SMTP exactly as before.
 *
 * It sits INSIDE lib/demo-org-mail.ts (`createGuardedTransport`), so every `getMailTransport(...).sendMail` caller gets it with
 * no edit, and demo / support suppression still runs first.
 */
import { pickValidEmail } from '@/lib/email-address'
import { createServiceClient } from '@/lib/supabase/service'

const RESEND_URL = 'https://api.resend.com/emails'
const NAME_MAX = 80
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

export type CompanyMailRoute = { apiKey: string; domain: string; companyName: string; companyEmail: string | null }

let warned = false
/** Test hook. */
export function resetCompanyMailWarning() {
  warned = false
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

/**
 * Where this company's mail goes. null = the existing SMTP path (original company, no company, env incomplete, or the company
 * can't be read — then SMTP, so nothing is lost; the From it carries is the one getCrmEmailFrom decided).
 */
export async function resolveCompanyMailRoute(orgId: string | null | undefined): Promise<CompanyMailRoute | null> {
  if (!orgId) return null
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const domain = cleanDomain(process.env.COMPANY_MAIL_FROM_DOMAIN)
  const configured = !!apiKey && !!domain && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)
  if (!configured && warned) return null // already warned once; skip the org read for every later send
  let org: { name?: unknown; email?: unknown; original_brand?: unknown } | null = null
  try {
    const { data, error } = await createServiceClient().from('orgs').select('name, email, original_brand').eq('id', orgId).maybeSingle()
    if (error) throw error
    org = data
  } catch (e) {
    console.error('company mail: company not readable; using SMTP', { orgId, e })
    return null
  }
  if (!org || org.original_brand === true) return null
  if (!configured) {
    if (!warned) {
      warned = true
      console.warn('company mail: RESEND_API_KEY and COMPANY_MAIL_FROM_DOMAIN are not both set; other companies still send through the shared SMTP login (see docs/company-mail-setup.md)')
    }
    return null
  }
  return { apiKey, domain, companyName: String(org.name ?? ''), companyEmail: validEmailOrNull(org.email) }
}

type Addressish = unknown
function toList(v: Addressish): string[] {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!x) return
    if (typeof x === 'string') out.push(...x.split(',').map((s) => s.trim()).filter(Boolean))
    else if (Array.isArray(x)) x.forEach(walk)
    else if (typeof x === 'object' && typeof (x as { address?: unknown }).address === 'string') {
      const a = x as { name?: unknown; address: string }
      const name = sanitizeDisplayName(a.name)
      out.push(name ? `"${name}" <${a.address}>` : a.address)
    }
  }
  walk(v)
  return out
}

function oneHeaderValue(v: unknown): string {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').trim()
}

type MailAttachment = { filename?: string; content?: unknown; contentType?: string; encoding?: string }
function toAttachment(a: MailAttachment): Record<string, string> {
  const raw = a.content
  const content = Buffer.isBuffer(raw) ? raw.toString('base64') : raw instanceof Uint8Array ? Buffer.from(raw).toString('base64') : a.encoding === 'base64' ? String(raw ?? '') : Buffer.from(String(raw ?? ''), 'utf8').toString('base64')
  return { filename: oneHeaderValue(a.filename) || 'attachment', content, ...(a.contentType ? { content_type: oneHeaderValue(a.contentType) } : {}) }
}

/** The Resend request body for one nodemailer-shaped message. Pure. */
export function buildResendPayload(route: CompanyMailRoute, message: Record<string, any>): Record<string, unknown> {
  const replyTo = validEmailOrNull(typeof message.replyTo === 'string' ? message.replyTo : null) ?? route.companyEmail
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries((message.headers ?? {}) as Record<string, unknown>)) {
    if (/^[A-Za-z0-9-]+$/.test(k) && !/^(from|to|cc|bcc|reply-to|subject)$/i.test(k)) headers[k] = oneHeaderValue(v)
  }
  const cc = toList(message.cc)
  const bcc = toList(message.bcc)
  const attachments = Array.isArray(message.attachments) ? message.attachments.map(toAttachment) : []
  return {
    from: companyFromHeader(route.companyName, route.domain),
    to: toList(message.to),
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    subject: oneHeaderValue(message.subject),
    ...(message.html ? { html: String(message.html) } : {}),
    ...(message.text ? { text: String(message.text) } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(attachments.length ? { attachments } : {}),
  }
}

/** Sends one message through Resend. Throws on any failure (callers already handle a thrown SMTP error). Result is nodemailer-shaped. */
export async function sendViaResend(route: CompanyMailRoute, message: Record<string, any>): Promise<{ messageId: string; accepted: string[]; rejected: string[]; response: string }> {
  const payload = buildResendPayload(route, message)
  const to = payload.to as string[]
  if (to.length === 0) throw new Error('company mail: no recipient')
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${route.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string }
  if (!res.ok) {
    const err = new Error(`Resend ${res.status}: ${String(body.message ?? body.name ?? 'send failed').slice(0, 200)}`) as Error & { responseCode?: number }
    err.responseCode = res.status
    throw err
  }
  return { messageId: String(body.id ?? ''), accepted: to, rejected: [], response: 'resend' }
}
