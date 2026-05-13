/** First string that looks like an email; use for auth.users vs public.users fallbacks. */
export function pickValidEmail(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim()
      if (t.includes('@')) return t
    }
  }
  return null
}
