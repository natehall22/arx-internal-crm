/** @jest-environment node */
/**
 * Reliability sweep 2026-11-13 #3: on the shared app every email went out as the original company, whichever company sent it.
 * The From is now per company (its own name + email, the companyIdentity rule invoices use); the original company's stays
 * byte-identical.
 */
import { execSync } from 'child_process'

import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { formatFromHeader, getCrmEmailFrom } from '@/lib/crm-email-from'

const ORIGINAL = { id: 'arx', name: 'ARX Roofing & Exteriors', email: 'info@arxroofing.com' }
const db = (orgs: Array<Record<string, unknown>>) => createFakeDb({ orgs }).client

const saved = { from: process.env.SMTP_FROM, user: process.env.SMTP_USER, fence: process.env.DEPLOYMENT_ORG_ID }
afterEach(() => {
  for (const [k, v] of [['SMTP_FROM', saved.from], ['SMTP_USER', saved.user], ['DEPLOYMENT_ORG_ID', saved.fence]] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
beforeEach(() => {
  delete process.env.SMTP_FROM
  delete process.env.DEPLOYMENT_ORG_ID
})

describe('shared app (no fence)', () => {
  it('the original company: byte-identical to before (with and without SMTP_FROM)', async () => {
    expect(await getCrmEmailFrom('arx', db([ORIGINAL]))).toBe('ARX Roofing <info@arxroofing.com>')
    process.env.SMTP_FROM = 'ARX Roofing & Exteriors <info@arxroofing.com>'
    expect(await getCrmEmailFrom('arx', db([ORIGINAL]))).toBe('ARX Roofing & Exteriors <info@arxroofing.com>')
    process.env.SMTP_FROM = 'someone@else.example'
    expect(await getCrmEmailFrom('arx', db([ORIGINAL]))).toBe('ARX Roofing <info@arxroofing.com>')
  })
  it('another company sends as itself, never as the original company', async () => {
    const orgs = [ORIGINAL, { id: 'p', name: 'Precision Exteriors', email: 'office@precision.example' }]
    expect(await getCrmEmailFrom('p', db(orgs))).toBe('Precision Exteriors <office@precision.example>')
    expect(await getCrmEmailFrom('q', db([{ id: 'q', name: 'Smith & Sons', email: 'hi@smith.example' }]))).toBe('"Smith & Sons" <hi@smith.example>')
  })
  it('a company with no email: blank (= email not set up), never someone else’s From', async () => {
    expect(await getCrmEmailFrom('p', db([{ id: 'p', name: 'Precision', email: null }]))).toBe('')
  })
  it('a company that cannot be read: blank (fail closed)', async () => {
    expect(await getCrmEmailFrom('missing', db([ORIGINAL]))).toBe('')
  })
  it('mail for no company keeps the deployment From', async () => {
    expect(await getCrmEmailFrom(null)).toBe('ARX Roofing <info@arxroofing.com>')
  })
})

describe('a fenced copy', () => {
  it('company identity first; its env From when the company has no email', async () => {
    process.env.DEPLOYMENT_ORG_ID = 'p'
    process.env.SMTP_FROM = 'Mailer <mailer@precision.example>'
    expect(await getCrmEmailFrom('p', db([{ id: 'p', name: 'Precision', email: 'office@precision.example' }]))).toBe('Precision <office@precision.example>')
    expect(await getCrmEmailFrom('p', db([{ id: 'p', name: 'Precision', email: null }]))).toBe('Mailer <mailer@precision.example>')
  })
})

describe('formatFromHeader', () => {
  it('quotes names that need it and strips header-breaking characters', () => {
    expect(formatFromHeader('Green Leaf', 'a@b.c')).toBe('Green Leaf <a@b.c>')
    expect(formatFromHeader('A, B "C"\r\nBcc: x', 'a@b.c')).toBe('"A, B CBcc: x" <a@b.c>')
    expect(formatFromHeader('', 'a@b.c')).toBe('a@b.c')
  })
})

describe('every sender names its company', () => {
  it('no getCrmEmailFrom() call without a company (only the public trial form passes null)', () => {
    const out = execSync("grep -rn 'getCrmEmailFrom(' app lib components --include=*.ts --include=*.tsx | grep -v __tests__ || true", { encoding: 'utf8' })
    const calls = out.split('\n').filter((l) => l && !l.includes('lib/crm-email-from.ts') && !/import|export \{/.test(l))
    expect(calls.length).toBeGreaterThan(30)
    expect(calls.filter((l) => /getCrmEmailFrom\(\)/.test(l))).toEqual([])
    expect(calls.filter((l) => /getCrmEmailFrom\(null\)/.test(l)).map((l) => l.split(':')[0])).toEqual(['app/api/trial-signup/route.ts'])
  })
})
