import type { SupabaseClient } from '@supabase/supabase-js'

import { legacyBrandFallback } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'

/** The original company's From (its info@ alias). Legacy only; delete with `legacyBrandFallback`. */
const LEGACY_FROM = 'ARX Roofing <info@arxroofing.com>'
const LEGACY_FROM_ADDRESS = /info@arxroofing\.com/i

/** `Name <address>`, the name quoted when it holds anything RFC 5322 needs quoted. The one From formatter (invoices use it too). */
export function formatFromHeader(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n]/g, '').trim()
  if (!clean) return address
  return /[^A-Za-z0-9 .'_-]/.test(clean) ? `"${clean}" <${address}>` : `${clean} <${address}>`
}

/**
 * The deployment's own From, for mail that belongs to no company (the public marketing forms) — and, on the shared app
 * (no DEPLOYMENT_ORG_ID fence), the original company's mail, exactly the old rule: SMTP_FROM only when it already targets the
 * original info@, otherwise the branded info@. A fenced copy: env SMTP_FROM, else SMTP_USER.
 */
function deploymentFrom(): string {
  const configured = process.env.SMTP_FROM?.trim()
  if (legacyBrandFallback()) {
    if (configured && LEGACY_FROM_ADDRESS.test(configured)) return configured
    return LEGACY_FROM
  }
  return configured || process.env.SMTP_USER?.trim() || ''
}

async function readOrgIdentity(admin: SupabaseClient, orgId: string): Promise<{ name: string; email: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await admin.from('orgs').select('name, email').eq('id', orgId).maybeSingle()
    if (!error) return data ? { name: String(data.name ?? '').trim(), email: String(data.email ?? '').trim() } : null
  }
  return null
}

/**
 * Canonical From header for CRM transactional mail sent FOR a company (`orgId`) — the same identity rule as invoices and
 * customer messages (`companyIdentity`: the company's own name + email from its org row), so a customer never gets another
 * company's From on the shared app.
 *
 * - `orgId` null (mail that belongs to no company): the deployment's From (`deploymentFrom`).
 * - Shared app (no fence) and the company IS the original company (its email column is the original info@ alias): exactly the
 *   old From, byte-identical (test-locked). Delete this branch with the legacy brand fallback.
 * - Otherwise the company's name + email. A company with no email on the shared app: '' (callers treat it as "email isn't set
 *   up" — never someone else's From). A fenced copy keeps its env From when the company has no email.
 * - The org row can't be read (after one retry): '' — fail closed rather than send under the wrong name.
 *
 * If SMTP authenticates as a different mailbox, Gmail rewrites the visible From unless Workspace "Send mail as"
 * includes the From address — or SMTP_USER is switched to it. Do not set nodemailer envelope.from to the From while
 * SMTP_USER differs: Gmail may reject MAIL FROM mismatches and break delivery.
 */
export async function getCrmEmailFrom(orgId: string | null, admin?: SupabaseClient): Promise<string> {
  if (!orgId) return deploymentFrom()
  const org = await readOrgIdentity(admin ?? createServiceClient(), orgId)
  if (!org) {
    console.error('getCrmEmailFrom: company not readable; not sending under a guessed From', { orgId })
    return ''
  }
  if (legacyBrandFallback() && new RegExp(`^${LEGACY_FROM_ADDRESS.source}$`, 'i').test(org.email)) return deploymentFrom()
  if (org.email && org.name) return formatFromHeader(org.name, org.email)
  if (org.email) return org.email
  return legacyBrandFallback() ? '' : deploymentFrom()
}
