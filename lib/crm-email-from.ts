import { legacyBrandFallback } from '@/lib/org-brand'

/**
 * Canonical From header for all CRM transactional outbound mail.
 *
 * Each company's copy has its own SMTP account, so the From is per deployment: env SMTP_FROM
 * (e.g. `Company Name <info@company.com>`), else SMTP_USER.
 *
 * Legacy (no DEPLOYMENT_ORG_ID fence = the original company's prod today, see lib/org-brand.ts `legacyBrandFallback`):
 * exactly the old rule — SMTP_FROM only when it already targets the original info@, otherwise the branded info@ below.
 * Set SMTP_FROM to that same value before fencing that deployment and the From stays identical. Delete this branch with
 * the legacy brand fallback.
 *
 * If SMTP authenticates as a different mailbox, Gmail rewrites the visible From unless Workspace "Send mail as"
 * includes the From address — or SMTP_USER is switched to it. Do not set nodemailer envelope.from to the From while
 * SMTP_USER differs: Gmail may reject MAIL FROM mismatches and break delivery.
 */
export function getCrmEmailFrom(): string {
  const configured = process.env.SMTP_FROM?.trim()
  if (legacyBrandFallback()) {
    if (configured && /info@arxroofing\.com/i.test(configured)) {
      return configured
    }
    return 'ARX Roofing <info@arxroofing.com>'
  }
  return configured || process.env.SMTP_USER?.trim() || ''
}
