/**
 * Conservative person-name keys for Duke NM ↔ tax-roll joins.
 * Unique matches only. Ambiguous names are discarded, not guessed.
 */

const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'ESQ', 'TRUSTEE', 'WF', 'WIFE'])

const COMPANY_RE =
  /\b(LLC|L\.?L\.?C\.?|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|LLP|TRUST|CHURCH|HOA|ASSOCIATION|MINISTR|UNIVERSITY|COLLEGE|HOSPITAL|PROPERTIES|HOLDINGS|INVESTMENTS)\b/i

export type PersonKey = {
  last: string
  first: string
  firstToken: string
}

export function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function normalizeNameText(raw: string | null | undefined): string {
  if (!raw) return ''
  return collapseSpaces(
    raw
      .toUpperCase()
      .replace(/[.'`,]/g, ' ')
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9 -]/g, ' '),
  )
}

export function isCompanyName(raw: string | null | undefined): boolean {
  const text = normalizeNameText(raw)
  return text.length > 0 && COMPANY_RE.test(text)
}

function tokensOf(raw: string): string[] {
  return normalizeNameText(raw)
    .split(/[\s]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 0 && !SUFFIXES.has(t) && t !== 'AND')
}

function personFromTokens(tokens: string[], lastFirst: boolean): PersonKey | null {
  if (tokens.length === 0) return null
  if (tokens.length === 1) {
    return { last: tokens[0], first: '', firstToken: '' }
  }
  const last = lastFirst ? tokens[0] : tokens[tokens.length - 1]
  const firstTokens = lastFirst ? tokens.slice(1) : tokens.slice(0, -1)
  const first = firstTokens.join(' ')
  return { last, first, firstToken: firstTokens[0] ?? '' }
}

function splitAndClauses(raw: string): string[] {
  const text = normalizeNameText(raw)
  if (!text) return []
  return text
    .split(/\bAND\b/)
    .map((part) => collapseSpaces(part))
    .filter((part) => part.length > 0 && part !== 'WF')
}

export function peopleFromWesternName(raw: string): PersonKey[] {
  const clauses = splitAndClauses(raw)
  if (clauses.length === 2) {
    const left = tokensOf(clauses[0])
    const right = tokensOf(clauses[1])
    // "Thomas J and Marianne Mylet" — shared surname lives on the right clause.
    if (left.length >= 1 && left.length <= 3 && right.length >= 2) {
      const last = right[right.length - 1]
      const rightPerson = personFromTokens(right, false)
      const leftPerson = personFromTokens([...left, last], false)
      return [leftPerson, rightPerson].filter((p): p is PersonKey => Boolean(p))
    }
  }

  const people: PersonKey[] = []
  for (const clause of clauses) {
    if (isCompanyName(clause)) continue
    const comma = clause.split(',')
    if (comma.length === 2 && comma[0].trim() && comma[1].trim()) {
      const person = personFromTokens([...tokensOf(comma[1]), ...tokensOf(comma[0])], false)
      if (person) people.push(person)
      continue
    }
    const person = personFromTokens(tokensOf(clause), false)
    if (person) people.push(person)
  }
  return people
}

/** Tax rolls in Cabarrus/Gaston/Rowan/Union are typically LAST FIRST [MI]. */
export function peopleFromLastFirstName(raw: string): PersonKey[] {
  const people: PersonKey[] = []
  for (const clause of splitAndClauses(raw)) {
    if (isCompanyName(clause)) continue
    const person = personFromTokens(tokensOf(clause), true)
    if (person) people.push(person)
  }
  return people
}

export function peopleFromTaxRecord(options: {
  ownname: string | null | undefined
  ownfrst?: string | null
  ownlast?: string | null
}): PersonKey[] {
  const first = normalizeNameText(options.ownfrst)
  const last = normalizeNameText(options.ownlast)
  if (first && last) {
    return [{ last, first, firstToken: first.split(' ')[0] ?? '' }]
  }
  return peopleFromLastFirstName(options.ownname ?? '')
}

export function matchKeysForPerson(person: PersonKey, county: string, city?: string | null): string[] {
  const countyKey = county.trim().toLowerCase()
  const cityKey = normalizeNameText(city)
  const keys: string[] = []
  if (cityKey && person.first) {
    keys.push(`${countyKey}|${person.last}|${person.first}|${cityKey}`)
  }
  if (person.first) keys.push(`${countyKey}|${person.last}|${person.first}`)
  if (person.firstToken && person.firstToken !== person.first) {
    if (cityKey) keys.push(`${countyKey}|${person.last}|${person.firstToken}|${cityKey}`)
    keys.push(`${countyKey}|${person.last}|${person.firstToken}`)
  }
  return keys
}

export type UniqueIndexHit<T> = { value: T; unique: true } | { unique: false }

/**
 * Record values under each key. A key with 2+ values becomes non-unique.
 * Lookups later return a hit only when the key still points at exactly one value.
 */
export function addUniqueIndex<T>(
  index: Map<string, UniqueIndexHit<T>>,
  key: string,
  value: T,
  same: (a: T, b: T) => boolean,
): void {
  const existing = index.get(key)
  if (!existing) {
    index.set(key, { unique: true, value })
    return
  }
  if (!existing.unique) return
  if (same(existing.value, value)) return
  index.set(key, { unique: false })
}

export function lookupUnique<T>(index: Map<string, UniqueIndexHit<T>>, keys: string[]): T | null {
  for (const key of keys) {
    const hit = index.get(key)
    if (hit?.unique) return hit.value
  }
  return null
}
