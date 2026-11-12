/**
 * The ONE way to open an SMTP connection (server only): nodemailer's transport wrapped so mail addressed only to reserved
 * example addresses, or sent for a demo company (the sending org, `sendingOrgId`), is logged and dropped. Replaces the 17 hand-copied
 * `nodemailer.createTransport(...)` calls; `getMailTransport(orgId)` (lib/setter-email.ts) is the shared SMTP config on top of it.
 */
import nodemailer from 'nodemailer'

import { guardReservedRecipients, isDemoSenderOrg } from '@/lib/demo-org'
import { createServiceClient } from '@/lib/supabase/service'

export function createGuardedTransport(options: Parameters<typeof nodemailer.createTransport>[0], sendingOrgId?: string | null) {
  return guardReservedRecipients(nodemailer.createTransport(options), sendingOrgId ? () => isDemoSenderOrg(createServiceClient(), sendingOrgId) : undefined)
}
