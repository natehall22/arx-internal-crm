/**
 * Who a note's @mentions point at — exact matches only, never a prefix fan-out.
 *
 * A mention counts when the note contains `@<Full Name>` exactly (case-insensitive)
 * and the name is not continued by more letters/digits ("@Andrew Waltzman" is not
 * "@Andrew Waltz", "@Stenson" is not "@Sten"). Trailing punctuation, a hyphen or
 * a possessive "'s" end the name. At each `@` only the LONGEST matching name counts,
 * so "@Steve Potts" never also pings a user named "Steve" — and if the text
 * continues a longer known name ("@Andrew Waltzman" with users "Andrew" and
 * "Andrew Waltz"), the shorter name does not match either.
 *
 * The `@` may start the text or follow whitespace, brackets, quotes, `*`, `-`, `—`,
 * `–` or `/`. It may NOT follow a letter/digit (email addresses), and an `@` inside
 * a URL (`https://…/@x`, `www.…/@x`) is not a mention.
 *
 * When two active users share the same full name, the text alone is ambiguous:
 * only the one(s) the composer picked (`selectedUserIds`) are notified. With no
 * pick, nobody is — better a missed ping than one sent to the wrong person.
 * `selectedUserIds` never adds anyone on its own: a picked user only counts if
 * their `@Full Name` is still in the text.
 *
 * Pure and client-safe. Single home for mention matching; the server
 * (POST /api/ops/jobs/[id]/notes) is the only place that resolves recipients.
 */

export type MentionCandidate = {
  id: string
  full_name: string | null
}

const LETTER_OR_DIGIT = new RegExp('[\\p{L}\\p{M}\\p{N}_]', 'u')
const LETTER = new RegExp('[\\p{L}\\p{M}]', 'u')
const ALLOWED_BEFORE_AT = new RegExp('[\\s(\\[{"\'`‘’“”*\\-—–/]', 'u')

function normalizeFullName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim()
}

/** True when `after` (text right after a candidate name) continues the name. */
function continuesName(after: string): boolean {
  const c0 = after.charAt(0)
  if (!c0) return false
  if (LETTER_OR_DIGIT.test(c0)) return true
  // "@Andrew-Waltz" / "@Ann O'Neil" continue; "@Steve Potts's" (possessive) and "@Sten-" don't.
  if ((c0 === '-' || c0 === "'" || c0 === '’') && LETTER.test(after.charAt(1))) {
    const possessive =
      (c0 === "'" || c0 === '’') &&
      after.charAt(1).toLowerCase() === 's' &&
      !LETTER_OR_DIGIT.test(after.charAt(2))
    return !possessive
  }
  return false
}

/** The `@` at index `i` is inside a URL (scheme or www. in the same word). */
const MAX_MENTIONS_PER_NOTE = 10
/** Longer than any full name plus the continuation check needs. */
const MAX_NAME_SPAN = 200

function insideUrl(text: string, i: number): boolean {
  // Bounded look-back keeps this linear on pathological notes.
  const from = Math.max(0, i - 200)
  const start = text.slice(from, i).search(/\S+$/)
  if (start === -1) return false
  const word = text.slice(from + start, i).toLowerCase()
  return word.includes('://') || word.startsWith('www.')
}

/**
 * Mentioned users in the order they first appear in the note (deduplicated).
 */
export function resolveNoteMentions<T extends MentionCandidate>(
  note: string,
  users: readonly T[],
  selectedUserIds: readonly string[] = []
): T[] {
  const text = String(note ?? '')
  if (!text.includes('@') || users.length === 0) return []

  const selected = new Set(selectedUserIds.filter((id) => typeof id === 'string'))

  // Group users by lowercase full name; longest names first so the longest match wins.
  const byName = new Map<string, T[]>()
  for (const u of users) {
    if (!u?.id) continue
    const name = normalizeFullName(u.full_name)
    if (!name) continue
    const key = name.toLowerCase()
    const list = byName.get(key)
    if (list) list.push(u)
    else byName.set(key, [u])
  }
  const names = Array.from(byName.keys()).sort((a, b) => b.length - a.length)

  // Compare against a whitespace-collapsed copy so "@Steve  Potts" still matches.
  const haystack = text.replace(/\s+/g, ' ')
  const lower = haystack.toLowerCase()

  const out: T[] = []
  const seen = new Set<string>()

  for (let i = lower.indexOf('@'); i !== -1; i = lower.indexOf('@', i + 1)) {
    if (i > 0 && !ALLOWED_BEFORE_AT.test(lower.charAt(i - 1))) continue
    if (insideUrl(lower, i)) continue

    if (out.length >= MAX_MENTIONS_PER_NOTE) break
    const rest = lower.slice(i + 1, i + 1 + MAX_NAME_SPAN)
    // Longest candidate the text starts with. If the text continues it with more
    // letters, the writer typed some other (longer) name — no shorter name matches.
    const longest = names.find((n) => rest.startsWith(n))
    if (!longest || continuesName(rest.slice(longest.length))) continue

    const matches = byName.get(longest) ?? []
    const chosen = matches.length === 1 ? matches : matches.filter((u) => selected.has(u.id))
    for (const u of chosen) {
      if (seen.has(u.id)) continue
      seen.add(u.id)
      out.push(u)
    }
  }

  return out
}

/**
 * Who can be @mentioned (and so emailed): active users with a name and an email.
 * The server passes its org user list through this before resolving mentions.
 */
export function mentionCandidates<T extends MentionCandidate & { email?: string | null; active?: boolean | null }>(
  users: readonly T[]
): T[] {
  return users.filter(
    (u) =>
      !!u?.id &&
      u.active !== false &&
      normalizeFullName(u.full_name) !== '' &&
      typeof u.email === 'string' &&
      u.email.trim() !== ''
  )
}

/**
 * Display-only highlighter for "@Name" in rendered notes: group 1 is the character
 * before "@" (or empty at start), group 2 the name — letters incl. accents, hyphens,
 * apostrophes, plus a capitalised last name if one follows ("@Steve Potts", "@José",
 * "@Ann O'Neil", "@Mary-Kate"). Not used to decide who gets notified.
 * Returns a fresh global regex each call (it carries lastIndex state).
 */
export function noteMentionHighlightRegex(): RegExp {
  const rest = "[\\p{L}\\p{M}'\u2019-]*"
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])@([\\p{L}\\p{M}]${rest}(?: \\p{Lu}${rest})?)`, 'gu')
}
