/**
 * The ONE way to open an SMTP connection (server only): nodemailer's transport wrapped so mail addressed only to reserved
 * example addresses, or sent for a demo company (the sending org, `sendingOrgId`), is logged and dropped. Replaces the 17 hand-copied
 * `nodemailer.createTransport(...)` calls; `getMailTransport(orgId)` (lib/setter-email.ts) is the shared SMTP config on top of it.
 */
import nodemailer from 'nodemailer'

import { guardReservedRecipients, isDemoSenderOrg } from '@/lib/demo-org'
import { createServiceClient } from '@/lib/supabase/service'
import { assertNoSupportSend } from '@/lib/support/send-guard'

export function createGuardedTransport(options: Parameters<typeof nodemailer.createTransport>[0], sendingOrgId?: string | null) {
  // A support session (lib/support/send-guard.ts) can send nothing: the mail is refused, never faked as sent.
  return guardReservedRecipients(nodemailer.createTransport(options), async () => {
    await assertNoSupportSend('email', { sendingOrgId: sendingOrgId ?? null })
    return sendingOrgId ? isDemoSenderOrg(createServiceClient(), sendingOrgId) : false
  })
}
