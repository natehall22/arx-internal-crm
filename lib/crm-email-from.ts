/**
 * Canonical From header for all CRM transactional outbound mail.
 *
 * Prefer SMTP_FROM when it already targets info@; otherwise use branded info@.
 *
 * If SMTP authenticates as a different mailbox (e.g. personal @arxroofing.com on
 * smtp.gmail.com), Gmail rewrites the visible From unless Workspace “Send mail as”
 * includes info@ — or SMTP_USER is switched to info@. Do not set nodemailer
 * envelope.from to info@ while SMTP_USER differs: Gmail may reject MAIL FROM
 * mismatches and break delivery.
 */
export function getCrmEmailFrom(): string {
  const configured = process.env.SMTP_FROM?.trim()
  if (configured && /info@arxroofing\.com/i.test(configured)) {
    return configured
  }
  return 'ARX Roofing <info@arxroofing.com>'
}
