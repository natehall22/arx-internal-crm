/**
 * Phone numbers for texting (client-safe, pure). US / Canada only in v1: every number is stored and compared as E.164
 * (`+1NXXNXXXXXX`), the one spelling used in the consent table, the suppression list, the send log and the inbound log.
 */

/** "(850) 555-0100", "850-555-0100", "1 850 555 0100", "+18505550100" → "+18505550100"; anything else (or not dialable) → null. */
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  // "+44 …" and friends: not a US / Canada number. A bare 10 / 11 digit number is taken as US.
  if (trimmed.startsWith('+') && !/^\+1\D*\d/.test(trimmed)) return null
  // A trailing extension ("x12", "ext 4") is not part of a mobile number: refuse rather than guess.
  if (/[a-z]/i.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.length === 10 ? digits : null
  if (!ten) return null
  // NANP: area code and exchange start 2–9; area code is never an N11 service code; not 10 identical digits.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten) || /^[2-9]11/.test(ten) || /^(\d)\1{9}$/.test(ten)) return null
  return `+1${ten}`
}

/** "+18505550100" → "(850) 555-0100" (null when it is not an E.164 US number). */
export function formatE164(e164: string | null | undefined): string | null {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164 ?? '')
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : null
}

/** What the office sees of a customer's number in a status line: "(850) ***-0100". */
export function maskE164(e164: string | null | undefined): string | null {
  const m = /^\+1([2-9]\d{2})([2-9]\d{2})(\d{4})$/.exec(e164 ?? '')
  return m ? `(${m[1]}) ***-${m[3]}` : null
}

/** The last 10 digits — how the customers table is matched (a stored phone may be 10 or 11 digits). */
export function last10(e164: string): string {
  return e164.replace(/\D/g, '').slice(-10)
}
