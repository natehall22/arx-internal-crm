/**
 * Logging a customer contact (call / text / email / visit) — client-safe. ONE outcome list for the whole app; the
 * write itself is postMessage (lib/threads/post-message.ts) with `draft.contact`, so a logged contact is an ordinary
 * thread row (type = the contact kind) that job catch-up already reads as "last customer contact".
 *
 * The inside-sales follow-up screens still keep their own result wording in the body (Known Redundancy, CLAUDE.md);
 * move them onto this list when they are next touched.
 */

export const CONTACT_KINDS = ['call', 'text', 'email', 'visit'] as const
export type ContactKind = (typeof CONTACT_KINDS)[number]

export const CONTACT_OUTCOMES = ['reached', 'voicemail', 'no_answer', 'sent', 'replied'] as const
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number]

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = { call: 'Call', text: 'Text', email: 'Email', visit: 'Visit' }

export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  reached: 'Talked to them',
  voicemail: 'Left voicemail',
  no_answer: 'No answer',
  sent: 'Sent',
  replied: 'They replied',
}

/** Which outcomes make sense for each kind, in button order. */
export const OUTCOMES_FOR_KIND: Record<ContactKind, readonly ContactOutcome[]> = {
  call: ['reached', 'voicemail', 'no_answer'],
  text: ['sent', 'replied'],
  email: ['sent', 'replied'],
  visit: ['reached', 'no_answer'],
}

/** "We actually got through" — a touchpoint that counts as done. */
export function contactConnected(outcome: ContactOutcome): boolean {
  return outcome === 'reached' || outcome === 'sent' || outcome === 'replied'
}

export function isContactKind(v: unknown): v is ContactKind {
  return typeof v === 'string' && (CONTACT_KINDS as readonly string[]).includes(v)
}

export function isContactOutcome(v: unknown): v is ContactOutcome {
  return typeof v === 'string' && (CONTACT_OUTCOMES as readonly string[]).includes(v)
}

/** A request body's `contact` → a valid { kind, outcome } pair, or null. */
export function parseContact(v: unknown): { kind: ContactKind; outcome: ContactOutcome } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { kind, outcome } = v as { kind?: unknown; outcome?: unknown }
  if (!isContactKind(kind) || !isContactOutcome(outcome)) return null
  if (!OUTCOMES_FOR_KIND[kind].includes(outcome)) return null
  return { kind, outcome }
}

/** The thread text for a logged contact: "Call — Left voicemail" plus the optional note. */
export function contactBody(contact: { kind: ContactKind; outcome: ContactOutcome }, note?: string | null): string {
  const head = `${CONTACT_KIND_LABELS[contact.kind]} — ${CONTACT_OUTCOME_LABELS[contact.outcome]}`
  const extra = String(note ?? '').trim()
  return extra ? `${head}: ${extra}` : head
}
