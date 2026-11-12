/** @jest-environment node */
import { buildDemoDataset, DEMO_CREWS, DEMO_FEATURES, DEMO_PEOPLE, demoSeedRaw, isFictionalEmail, isFictionalPhone, DEMO_DEFAULTS } from '@/lib/demo-company-data'
import { parseCompanySeedInput } from '@/lib/company-seed'
import { DEMO_LOCKED_FEATURES } from '@/lib/demo-org'
import { isReservedMailDomain } from '@/lib/demo-org'
import { readFileSync } from 'fs'
import { join } from 'path'

const TODAY = '2026-11-11' // a Wednesday
const data = buildDemoDataset(TODAY)

describe('demo dataset', () => {
  it('is deterministic for a day', () => {
    expect(JSON.stringify(buildDemoDataset(TODAY))).toBe(JSON.stringify(data))
  })

  it('about 40 customers, 3 commercial accounts with several properties each', () => {
    expect(data.customers.length).toBe(40)
    const commercial = data.customers.filter((c) => c.commercial)
    expect(commercial).toHaveLength(3)
    for (const c of commercial) expect(c.properties.length).toBeGreaterThanOrEqual(2)
    expect(data.customers.some((c) => c.name === 'Dana Whitfield')).toBe(true)
  })

  it('everything is fictional: 555-01xx phones, demo.example.com emails, unique', () => {
    const emails = new Set<string>()
    const phones = new Set<string>()
    for (const c of data.customers) {
      expect(isFictionalEmail(c.email)).toBe(true)
      expect(isReservedMailDomain(c.email)).toBe(true) // the mail door drops these
      expect(isFictionalPhone(c.phone)).toBe(true)
      emails.add(c.email)
      phones.add(c.phone)
    }
    expect(emails.size).toBe(data.customers.length)
    for (const p of DEMO_PEOPLE) {
      expect(isFictionalEmail(p.email)).toBe(true)
      expect(isFictionalPhone(p.phone)).toBe(true)
    }
    for (const v of data.vendors) {
      expect(isFictionalEmail(v.email)).toBe(true)
      expect(isFictionalPhone(v.phone)).toBe(true)
    }
    expect(DEMO_DEFAULTS.textingE164).toMatch(/^\+1850555010\d$/)
  })

  it('properties carry gate code / dog / irrigation values', () => {
    const props = data.customers.flatMap((c) => c.properties)
    expect(props.some((p) => p.gate)).toBe(true)
    expect(props.some((p) => p.dog !== 'No dog')).toBe(true)
    expect(props.some((p) => p.irrigation !== 'None')).toBe(true)
  })

  it('five plan templates incl. seasonal weekly, biweekly, monthly winter, quarterly wash and an inspection plan', () => {
    expect(data.templates.map((t) => t.name)).toEqual(['Weekly mowing (seasonal)', 'Biweekly mowing (shoulder season)', 'Monthly winter check-in', 'Quarterly pressure wash', 'Yard & roof care inspection plan'])
  })

  it('plans point at real templates, customers and crews', () => {
    expect(data.planAssignments.length).toBeGreaterThan(30)
    const keys = new Set(data.customers.map((c) => c.key))
    for (const a of data.planAssignments) {
      expect(keys.has(a.customerKey)).toBe(true)
      expect(data.templates[a.template]).toBeTruthy()
      const c = data.customers.find((x) => x.key === a.customerKey)!
      expect(c.properties[a.propertyIndex]).toBeTruthy()
      expect(DEMO_CREWS.some((cr) => cr.key === a.crew)).toBe(true)
    }
  })

  it('quotes: one sent with optional items, one approved with a deposit, one expired', () => {
    const by = Object.fromEntries(data.quotes.map((q) => [q.key, q]))
    expect(by.sent.lines.some((l) => l.optional)).toBe(true)
    expect(by.sent.expiresInDays).toBeGreaterThan(0)
    expect(by.approved.status).toBe('accepted')
    expect(by.approved.depositPercent).toBeGreaterThan(0)
    expect(by.expired.expiresInDays).toBeLessThan(0)
  })

  it('the rain day and grading hours sit in the past, on workdays', () => {
    expect(data.visitOutcomes.rainDay < TODAY).toBe(true)
    expect(data.visitOutcomes.rainDayMoveTo > data.visitOutcomes.rainDay).toBe(true)
    for (const d of data.grading.days) {
      expect(d.ymd < TODAY).toBe(true)
      const dow = new Date(`${d.ymd}T12:00:00Z`).getUTCDay()
      expect([0, 6]).not.toContain(dow)
      expect(d.tractor[1]).toBeGreaterThan(d.tractor[0])
    }
  })

  it('every switch a service company shows is on; QuickBooks and AI writes are not', () => {
    for (const k of ['servicePlans', 'timeTracking', 'hourlyBilling', 'customerMessages', 'customerPortal', 'quoteApproval'] as const) expect(DEMO_FEATURES[k]).toBe(true)
    expect(DEMO_FEATURES.aiConnector).toBe(true)
    for (const k of DEMO_LOCKED_FEATURES) expect(DEMO_FEATURES[k]).toBe(false)
    expect(DEMO_FEATURES.projectTools).toBe(false)
  })

  it('the demo seed input is a valid company seed with the demo flag; --name / --profile override', () => {
    const r = parseCompanySeedInput(demoSeedRaw())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.input.demo).toBe(true)
      expect(r.input.org.name).toBe('Gulf Coast Grounds & Exterior')
      expect(r.input.org.subdomain).toBe('demo')
      expect(r.input.profile).toBe('lawn_landscape')
    }
    const named = parseCompanySeedInput(demoSeedRaw({ name: 'Precision Maintenance', profile: 'exterior_cleaning' }))
    expect(named.ok && named.input.org.name).toBe('Precision Maintenance')
    expect(named.ok && named.input.profile).toBe('exterior_cleaning')
  })

  it('a normal seed file never becomes a demo (the flag is only ever set by the demo input)', () => {
    const example = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'seed-company.example.json'), 'utf8'))
    const r = parseCompanySeedInput(example)
    expect(r.ok && r.input.demo).toBe(false)
  })

  it('no credentials are in the dataset file', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'demo-company-data.ts'), 'utf8')
    expect(src).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i)
  })
})
