/** Minimal RFC-like check — rejects "@", "rep@", and strings without a domain. */
export const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmailFormat(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const t = value.trim()
  return t.length > 0 && EMAIL_FORMAT_RE.test(t)
}

/**
 * First valid email among candidates (auth.users preferred before public.users when passed in that order).
 */
export function pickValidEmail(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim()
      if (isValidEmailFormat(t)) return t
    }
  }
  return null
}
