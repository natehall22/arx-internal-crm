/**
 * The ONE way to open an SMTP connection (server only): nodemailer's transport wrapped so mail addressed only to reserved
 * example addresses — all a demo company has (lib/demo-org.ts) — is logged and dropped. Replaces the 17 hand-copied
 * `nodemailer.createTransport(...)` calls; `getMailTransport()` (lib/setter-email.ts) is the shared SMTP config on top of it.
 */
import nodemailer from 'nodemailer'

import { guardReservedRecipients } from '@/lib/demo-org'

export function createGuardedTransport(options: Parameters<typeof nodemailer.createTransport>[0]) {
  return guardReservedRecipients(nodemailer.createTransport(options))
}
