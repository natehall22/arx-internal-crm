/** @jest-environment node */
/**
 * Move signed documents — matching REUSES the Jobber matchers (no second one). These tests pin both halves: the answers
 * are the ones lib/customers.ts `matchExistingCustomer` and lib/jobber-import/files-match.ts `matchFileNames` give, and
 * what this module adds is only how several answers are combined (ambiguous → owner picks, nothing → kept for later).
 */
import * as customers from '@/lib/customers'
import * as filesMatch from '@/lib/jobber-import/files-match'
import { matchGroups } from '@/lib/signed-import/match'
import type { Group } from '@/lib/signed-import/group'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/lib/customers', () => {
  const real = jest.requireActual('@/lib/customers')
  return { ...real, matchExistingCustomer: jest.fn(real.matchExistingCustomer) }
})
jest.mock('@/lib/jobber-import/files-match', () => {
  const real = jest.requireActual('@/lib/jobber-import/files-match')
  return { ...real, matchFileNames: jest.fn(real.matchFileNames) }
})

const row = (id: string, name: string, email: string | null, extra: Partial<customers.CustomerIdentityRow> = {}): customers.CustomerIdentityRow => ({
  id,
  name,
  email_lower: email,
  phone_normalized: null,
  address_text: null,
  created_at: '2025-01-01T00:00:00Z',
  ...extra,
})
const CUSTOMERS = [row('c-jane', 'Jane Smith', 'jane@example.com'), row('c-bob', 'Bob Lee', 'bob@example.com'), row('c-jane2', 'Jane Smith', 'jane2@example.com'), row('c-ann', 'Ann Cole', null), row('c-pat', 'Pat Moss', 'shared@example.com', { created_at: '2024-12-31T00:00:00Z' }), row('c-lou', 'Lou Moss', 'shared@example.com')]

const group = (key: string, over: Partial<Group> = {}): Group => ({
  key,
  itemIds: ['i'],
  agreementIds: ['i'],
  certificateIds: [],
  envelopeId: null,
  envelopeIdIsReal: false,
  subject: null,
  emails: [],
  names: [],
  fileNames: ['x.pdf'],
  sentOn: null,
  completedOn: null,
  provider: null,
  notCompleted: false,
  ...over,
})
const one = (g: Group) => matchGroups([g], CUSTOMERS).get(g.key)!

describe('matchGroups', () => {
  test('one customer by email is sure', () => expect(one(group('g', { emails: ['bob@example.com'] }))).toMatchObject({ customerId: 'c-bob', how: 'email' }))
  test('an email match with a name that is ambiguous stays an email match', () => expect(one(group('g', { emails: ['bob@example.com'], fileNames: ['Jane Smith - Roof.pdf'] }))).toMatchObject({ customerId: 'c-bob', how: 'email' }))
  test('an email match that CONTRADICTS an exact name match is a conflict, not a win', () => {
    const m = one(group('g', { emails: ['bob@example.com'], fileNames: ['Ann Cole - Roof.pdf'] }))
    expect(m.customerId).toBeNull()
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['c-ann', 'c-bob'])
  })
  test('an email two customers share: the Jobber rule answers with the OLDEST, and a name that names the other one makes it a conflict', () => {
    expect(one(group('g', { emails: ['shared@example.com'] }))).toMatchObject({ customerId: 'c-pat', how: 'email' })
    const m = one(group('g', { emails: ['shared@example.com'], names: ['Lou Moss'] }))
    expect(m.customerId).toBeNull()
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['c-lou', 'c-pat'])
  })
  test('two signers who are two different customers → ambiguous, both offered', () => {
    const m = one(group('g', { emails: ['bob@example.com', 'jane@example.com'] }))
    expect(m).toMatchObject({ customerId: null, how: null })
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['c-bob', 'c-jane'])
  })
  test('an exact file-name match is sure; a name two customers share is ambiguous', () => {
    expect(one(group('g', { fileNames: ['Ann Cole - Contract.pdf'] }))).toMatchObject({ customerId: 'c-ann', how: 'exact' })
    const two = one(group('g', { fileNames: ['Jane Smith - Contract.pdf'] }))
    expect(two.customerId).toBeNull()
    expect(two.candidates.map((c) => c.id).sort()).toEqual(['c-jane', 'c-jane2'])
  })
  test('a signer name from the certificate matches like a file name', () => expect(one(group('g', { names: ['Ann Cole'] }))).toMatchObject({ customerId: 'c-ann', how: 'exact' }))
  test('nothing matches → no customer (never created here), no candidates', () => expect(one(group('g', { emails: ['nobody@x.com'], fileNames: ['Zed Zero.pdf'] }))).toEqual({ customerId: null, how: null, candidates: [] }))
  test('many groups in one call each get their own answer', () => {
    const m = matchGroups([group('a', { emails: ['bob@example.com'] }), group('b', { fileNames: ['Ann Cole.pdf'] }), group('c')], CUSTOMERS)
    expect([m.get('a')!.customerId, m.get('b')!.customerId, m.get('c')!.customerId]).toEqual(['c-bob', 'c-ann', null])
  })
})

describe('no second matcher', () => {
  test('it calls the Jobber matchers', () => {
    one(group('g', { emails: ['bob@example.com'], fileNames: ['Ann Cole.pdf'] }))
    expect(customers.matchExistingCustomer).toHaveBeenCalled()
    expect(filesMatch.matchFileNames).toHaveBeenCalled()
  })
  test('the module holds no email / name matching of its own', () => {
    const src = readFileSync(join(process.cwd(), 'lib/signed-import/match.ts'), 'utf8')
    expect(src).toMatch(/from '@\/lib\/customers'/)
    expect(src).toMatch(/from '@\/lib\/jobber-import\/files-match'/)
    // No lookup table of its own, no string-similarity code.
    expect(src).not.toMatch(/levenshtein|new Map<string, CustomerName|toLowerCase\(\)\.split/)
  })
  test('the Jobber import still matches files by the same function', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/admin/import/jobber/[runId]/route.ts'), 'utf8')
    expect(src).toMatch(/matchFileNames/)
  })
})
