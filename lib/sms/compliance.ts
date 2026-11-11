/**
 * The words carriers and the FCC require (client-safe, pure): the one-time STOP line on a first text, and the answers to
 * STOP / HELP / START. Plain, informational, no promotion. Company name first.
 */
import { toGsmSafe } from '@/lib/sms/segments'

/** Added to the FIRST text a number ever gets from a company. */
export const FIRST_TEXT_FOOTER = 'Reply STOP to opt out.'

/** Max characters in a staff member's own text (three segments of plain text). */
export const STAFF_TEXT_MAX = 450

type Company = { name: string; phone?: string | null; email?: string | null }

/** "Name: text", plus the STOP line on a first message; typographic characters made plain so the text stays cheap. */
export function smsWords(text: string, o: { first: boolean; namePrefix?: string | null }): string {
  const named = o.namePrefix ? `${o.namePrefix}: ${text}` : text
  return toGsmSafe(o.first ? `${named} ${FIRST_TEXT_FOOTER}` : named).trim()
}

export function stopReply(c: Company): string {
  return toGsmSafe(`${c.name}: You are unsubscribed and will not get any more texts from us. Reply START to turn texts back on.`)
}

export function helpReply(c: Company): string {
  const how = [c.phone ? `call ${c.phone}` : '', c.email ? `email ${c.email}` : ''].filter(Boolean).join(' or ')
  return toGsmSafe(`${c.name}: Need help?${how ? ` Please ${how}.` : ''} Msg & data rates may apply. Reply STOP to cancel.`)
}

export function startReply(c: Company): string {
  return toGsmSafe(`${c.name}: You are subscribed again. Reply STOP to opt out, HELP for help.`)
}
