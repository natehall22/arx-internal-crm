/** @jest-environment node */
import fs from 'fs'
import path from 'path'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import {
  findBySigningToken,
  hashSigningToken,
  newSigningTokenColumns,
  openSigningToken,
  sealSigningToken,
  signingTokenOf,
} from '@/lib/signing-tokens'
import { isPlausibleSigningToken } from '@/lib/files/files-object'

const OLD_ENV = process.env.SUPABASE_SERVICE_ROLE_KEY
beforeAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests' })
afterAll(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_ENV })

describe('new tokens', () => {
  it('have the shapes the pages and download links already check', () => {
    const c = newSigningTokenColumns('contract')
    const o = newSigningTokenColumns('change-order')
    expect(isPlausibleSigningToken('contract', c.token)).toBe(true)
    expect(isPlausibleSigningToken('change-order', o.token)).toBe(true)
    expect(newSigningTokenColumns('contract').token).not.toBe(c.token)
  })

  it('are stored by hash and by an encrypted copy — never in the clear', () => {
    const { token, columns } = newSigningTokenColumns('change-order')
    expect(columns.signing_token).toBeNull()
    expect(columns.signing_token_hash).toBe(hashSigningToken(token))
    expect(columns.signing_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(columns)).not.toContain(token)
  })

  it('the encrypted copy opens back to the token; a different key, a tampered copy or junk do not', () => {
    const { token, columns } = newSigningTokenColumns('contract')
    expect(openSigningToken(columns.signing_token_enc)).toBe(token)
    expect(signingTokenOf(columns)).toBe(token)
    const tampered = String(columns.signing_token_enc).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))
    expect(openSigningToken(tampered)).toBeNull()
    expect(openSigningToken('junk')).toBeNull()
    expect(openSigningToken(null)).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'another-key'
    expect(openSigningToken(columns.signing_token_enc)).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests'
  })

  it('without any secret configured, nothing is sealed (signing still works; the link just can\'t be re-copied)', () => {
    const keep = { a: process.env.SUPABASE_SERVICE_ROLE_KEY, b: process.env.CUSTOMER_MESSAGE_LINK_SECRET, c: process.env.SIGNING_TOKEN_SECRET }
    delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.CUSTOMER_MESSAGE_LINK_SECRET; delete process.env.SIGNING_TOKEN_SECRET
    expect(sealSigningToken('x')).toBeNull()
    process.env.SUPABASE_SERVICE_ROLE_KEY = keep.a
    if (keep.b) process.env.CUSTOMER_MESSAGE_LINK_SECRET = keep.b
    if (keep.c) process.env.SIGNING_TOKEN_SECRET = keep.c
  })

  it('hashing ignores case and padding (a pasted link keeps working)', () => {
    expect(hashSigningToken(' ABCDEF ')).toBe(hashSigningToken('abcdef'))
  })
})

describe('findBySigningToken', () => {
  const OLD_UUID = '0b5d2485-9aba-4c1e-8f00-1234567890ab'
  const NEW_UUID = '5c1e7b0e-2f4a-4c55-9d3e-0a1b2c3d4e5f'
  const OLD_HEX = 'ab'.repeat(32)
  const NEW_HEX = 'cd'.repeat(32)
  const db = createFakeDb({
    order_form_contracts: [
      { id: 'old', signing_token: OLD_UUID },
      { id: 'new', signing_token: null, signing_token_hash: hashSigningToken(NEW_UUID) },
    ],
    job_change_orders: [
      { id: 'old', signing_token: OLD_HEX },
      { id: 'new', signing_token: null, signing_token_hash: hashSigningToken(NEW_HEX) },
    ],
  })

  it.each([
    ['contract', OLD_UUID, 'old'],
    ['contract', NEW_UUID, 'new'],
    ['change-order', OLD_HEX, 'old'],
    ['change-order', NEW_HEX, 'new'],
  ] as const)('%s %s → %s (plaintext from before hashing, or hashed)', async (kind, token, id) => {
    expect((await findBySigningToken(db.client, kind, token))?.id).toBe(id)
  })

  it('finds nothing for a wrong, malformed, empty or hash-valued token', async () => {
    expect(await findBySigningToken(db.client, 'contract', '5c1e7b0e-2f4a-4c55-9d3e-000000000000')).toBeNull()
    expect(await findBySigningToken(db.client, 'contract', 'not-a-uuid')).toBeNull()
    expect(await findBySigningToken(db.client, 'change-order', OLD_UUID)).toBeNull()
    expect(await findBySigningToken(db.client, 'contract', '')).toBeNull()
    expect(await findBySigningToken(db.client, 'contract', undefined)).toBeNull()
    expect(await findBySigningToken(db.client, 'change-order', hashSigningToken(NEW_HEX))).toBeNull()
  })
})

describe('guards', () => {
  const root = path.resolve(__dirname, '..', '..')
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

  it('no code looks a signing token up by plaintext column except through findBySigningToken', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) { if (!['node_modules', '.next', '__tests__'].includes(e.name)) walk(rel); continue }
        if (!/\.(ts|tsx)$/.test(e.name) || rel === path.join('lib', 'signing-tokens.ts')) continue
        if (/\.eq\(\s*'signing_token'/.test(read(rel))) offenders.push(rel)
      }
    }
    for (const d of ['app', 'lib', 'components']) walk(d)
    expect(offenders).toEqual([])
  })

})
