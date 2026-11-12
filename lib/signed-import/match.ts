/**
 * Move signed documents — which customer a signed document belongs to. NO matcher of its own: it asks the two rules the
 * Jobber import already uses (lib/customers.ts `matchExistingCustomer` = real email, then phone, then name + address;
 * lib/jobber-import/files-match.ts `matchFileNames` = exact / close names) and only decides what to do with their answers:
 *   one customer by email → sure ('email'); one by exact name → sure ('exact'); one by a close name → check ('close');
 *   several customers (husband and wife, two Jane Smiths, an email shared by two records) → NO choice, the owner picks;
 *   nothing → no customer (the document waits on the "keep for later" list; a customer is never created here).
 * An email match that disagrees with an EXACT name match is a conflict, not a win: the owner picks.
 */
import { matchExistingCustomer, type CustomerIdentityRow } from '@/lib/customers'
import { matchFileNames } from '@/lib/jobber-import/files-match'

import type { Group } from './group'

export type MatchHow = 'email' | 'exact' | 'close'
export type GroupMatch = { customerId: string | null; how: MatchHow | null; candidates: Array<{ id: string; name: string }> }

const MAX_CANDIDATES = 5

export function matchGroups(groups: Group[], customers: CustomerIdentityRow[]): Map<string, GroupMatch> {
  const nameOf = new Map(customers.map((c) => [c.id, c.name ?? 'Customer']))
  const cand = (ids: Iterable<string>) => Array.from(new Set(ids)).slice(0, MAX_CANDIDATES).map((id) => ({ id, name: nameOf.get(id) ?? 'Customer' }))

  // One call for every name in the batch (the Jobber matcher builds its lookup once per call).
  const strings = Array.from(new Set(groups.flatMap((g) => [...g.fileNames, ...g.names])))
  const byString = new Map(matchFileNames(strings, customers.map((c) => ({ id: c.id, name: c.name ?? '' }))).map((m) => [m.fileName, m]))

  const out = new Map<string, GroupMatch>()
  for (const g of groups) {
    const emailHits = new Set<string>()
    for (const email of g.emails) {
      const hit = matchExistingCustomer(customers, { name: '', email, phone: null, address_text: null })
      if (hit) emailHits.add(hit.id)
    }
    const exact = new Set<string>()
    const close = new Set<string>()
    const unclear = new Set<string>()
    for (const s of [...g.fileNames, ...g.names]) {
      const m = byString.get(s)
      if (!m) continue
      if (m.customerId && m.how === 'exact') exact.add(m.customerId)
      else if (m.customerId && m.how === 'close') close.add(m.customerId)
      else m.candidates.forEach((c) => unclear.add(c.id))
    }

    if (emailHits.size === 1) {
      const [id] = Array.from(emailHits)
      const rivals = Array.from(exact).filter((x) => x !== id)
      out.set(g.key, rivals.length ? { customerId: null, how: null, candidates: cand([id, ...rivals]) } : { customerId: id, how: 'email', candidates: cand([id]) })
    } else if (emailHits.size > 1) {
      out.set(g.key, { customerId: null, how: null, candidates: cand(emailHits) })
    } else if (exact.size === 1) {
      const [id] = Array.from(exact)
      out.set(g.key, { customerId: id, how: 'exact', candidates: cand([id]) })
    } else if (exact.size > 1) {
      out.set(g.key, { customerId: null, how: null, candidates: cand(exact) })
    } else if (close.size === 1 && unclear.size === 0) {
      const [id] = Array.from(close)
      out.set(g.key, { customerId: id, how: 'close', candidates: cand([id]) })
    } else {
      out.set(g.key, { customerId: null, how: null, candidates: cand([...Array.from(close), ...Array.from(unclear)]) })
    }
  }
  return out
}
