/**
 * The demo company's sample data — PURE (no I/O, no clock): `buildDemoDataset(today)` returns the same rows for the same
 * day, so tests can pin it. Everything here is fictional on purpose: names are made up, phones are the reserved 555-01xx
 * block, emails live under demo.example.com (lib/demo-org.ts drops outbound mail to that domain), street names are real
 * North Florida roads with invented house numbers. Applied by lib/demo-company-apply.ts; the seed entry point is
 * scripts/seed-company.ts --demo.
 */
import { addDaysYmd } from '@/lib/payroll-week-schedule'
import type { OrgFeature } from '@/lib/org-features'
import type { IndustryProfileId } from '@/lib/industry-profiles'

export const DEMO_MAIL_DOMAIN = 'demo.example.com'

export const DEMO_DEFAULTS = {
  name: 'Gulf Coast Grounds & Exterior',
  subdomain: 'demo',
  profile: 'lawn_landscape' as IndustryProfileId,
  phone: '(850) 555-0100',
  email: `office@${DEMO_MAIL_DOMAIN}`,
  address: '4100 Coastal Hwy, Crawfordville, FL 32327',
  ownerEmail: `owner@${DEMO_MAIL_DOMAIN}`,
  ownerName: 'Riley Hartwell',
  /** The company texting line the demo "owns": a reserved 555-01xx number, never a real one (texts go to the test adapter). */
  textingE164: '+18505550100',
} as const

/** Every switch a lawn / landscape / wash company would show. QuickBooks and the AI write switch are LOCKED off for a demo org. */
export const DEMO_FEATURES: Readonly<Partial<Record<OrgFeature, boolean>>> = Object.freeze({
  servicePlans: true,
  timeTracking: true,
  hourlyBilling: true,
  customerMessages: true,
  customerPortal: true,
  quoteApproval: true,
  onlinePayments: true, // Stripe TEST keys only: a live key shows the card as not set up (lib/online-payments/accounts.ts)
  texting: true, // test adapter + a 555 number
  aiConnector: true,
  aiConnectorWrites: false, // read-only
  quickbooks: false,
  projectTools: false, // turn on only for a builder demo
})

export type DemoPerson = {
  key: string
  email: string
  fullName: string
  phone: string
  /** users.role — see the note in lib/demo-company-apply.ts about crew leads. */
  role: 'sales_rep'
  /** Pay: hourly crew leads / crew, or commission salesperson. */
  pay: { kind: 'hourly'; rate: number } | { kind: 'commission'; percent: number }
  login: boolean
}

export const DEMO_PEOPLE: readonly DemoPerson[] = Object.freeze([
  { key: 'lead1', email: `marcus.bell@${DEMO_MAIL_DOMAIN}`, fullName: 'Marcus Bell', phone: '(850) 555-0111', role: 'sales_rep', pay: { kind: 'hourly', rate: 24 }, login: true },
  { key: 'lead2', email: `tanya.ruiz@${DEMO_MAIL_DOMAIN}`, fullName: 'Tanya Ruiz', phone: '(850) 555-0112', role: 'sales_rep', pay: { kind: 'hourly', rate: 23 }, login: false },
  { key: 'crew1', email: `luis.ortega@${DEMO_MAIL_DOMAIN}`, fullName: 'Luis Ortega', phone: '(850) 555-0113', role: 'sales_rep', pay: { kind: 'hourly', rate: 18 }, login: false },
  { key: 'crew2', email: `cody.hensley@${DEMO_MAIL_DOMAIN}`, fullName: 'Cody Hensley', phone: '(850) 555-0114', role: 'sales_rep', pay: { kind: 'hourly', rate: 17 }, login: false },
  { key: 'crew3', email: `jamal.pierce@${DEMO_MAIL_DOMAIN}`, fullName: 'Jamal Pierce', phone: '(850) 555-0115', role: 'sales_rep', pay: { kind: 'hourly', rate: 17 }, login: false },
  { key: 'sales', email: `priya.nolan@${DEMO_MAIL_DOMAIN}`, fullName: 'Priya Nolan', phone: '(850) 555-0116', role: 'sales_rep', pay: { kind: 'commission', percent: 8 }, login: false },
] as DemoPerson[])

export const DEMO_CREWS = Object.freeze([
  { key: 'mow-a', name: 'Mow Crew A', lead: 'lead1', members: ['crew1', 'crew2'], services: ['Lawn care', 'Clean-up'] },
  { key: 'wash-b', name: 'Wash & Tractor Crew B', lead: 'lead2', members: ['crew3'], services: ['Soft wash / pressure washing', 'Tractor / land work'] },
] as const)

export type DemoCustomField = { key: string; entity: 'property'; label: string; field_type: 'text' | 'dropdown'; options?: string[] }
export type DemoQuoteLine = { name: string; qty: number; unit: string; price: number; optional?: boolean; defaultOn?: boolean }
export type DemoQuote = { key: string; customerKey: string; title: string; status: 'sent' | 'accepted'; daysAgo: number; expiresInDays: number; depositPercent?: number; lines: DemoQuoteLine[] }

export const DEMO_CUSTOM_FIELDS: readonly DemoCustomField[] = Object.freeze([
  { key: 'gate', entity: 'property', label: 'Gate code', field_type: 'text' },
  { key: 'dog', entity: 'property', label: 'Dog on property', field_type: 'dropdown', options: ['No dog', 'Friendly dog', 'Dog — keep gate closed'] },
  { key: 'irrigation', entity: 'property', label: 'Irrigation', field_type: 'dropdown', options: ['None', 'Sprinkler zones', 'Drip beds only'] },
] as DemoCustomField[])

export type DemoProperty = {
  label: string | null
  address_line1: string
  city: string
  state: 'FL'
  zip: string
  lawnSqft: number
  gate: string | null
  dog: string
  irrigation: string
  access_notes: string | null
}

export type DemoCustomer = {
  key: string
  name: string
  email: string
  phone: string
  commercial: boolean
  properties: DemoProperty[]
}

// ---- name / street pools (fictional people, real-looking North Florida roads) ----
const FIRST = ['Dana', 'Avery', 'Morgan', 'Jordan', 'Casey', 'Taylor', 'Quinn', 'Rowan', 'Sloane', 'Emerson', 'Harper', 'Reese', 'Parker', 'Blake', 'Cameron', 'Drew', 'Elliot', 'Finley', 'Gray', 'Hollis', 'Jamie', 'Kendall', 'Logan', 'Marlow', 'Noel', 'Oakley', 'Peyton', 'Remy', 'Sage', 'Tatum', 'Wynn', 'Ashby', 'Bailey', 'Corbin', 'Devon', 'Ellis', 'Frankie']
const LAST = ['Whitfield', 'Calloway', 'Prescott', 'Langston', 'Merritt', 'Hollander', 'Ashworth', 'Brannigan', 'Corbett', 'Dunleavy', 'Everhart', 'Fairbanks', 'Gallagher', 'Hargrove', 'Ivester', 'Jernigan', 'Kilgore', 'Lockhart', 'Mabry', 'Nesbitt', 'Overton', 'Pickett', 'Quillen', 'Rutledge', 'Sutter', 'Thackeray', 'Underhill', 'Vance', 'Wetherby', 'Yarborough', 'Zimmer', 'Aldridge', 'Bellamy', 'Cantrell', 'Dawkins', 'Eastman', 'Fordham']
const STREETS = ['Crawfordville Hwy', 'Shadeville Rd', 'Surf Rd', 'Arran Rd', 'Bloxham Cutoff', 'Spring Creek Hwy', 'Ochlockonee Bay Trl', 'Mashes Sands Rd', 'Coastal Hwy', 'Sopchoppy Hwy', 'Oyster Bay Dr', 'Lower Bridge Rd', 'Magnolia Ridge Ln', 'Live Oak Ln', 'Wakulla Springs Rd', 'Medart Ct', 'Riverside Dr', 'Bayshore Dr', 'Pine Ridge Rd', 'Heron Cove Ln']
const TOWNS: Array<[string, string]> = [['Crawfordville', '32327'], ['Panacea', '32346'], ['Sopchoppy', '32358'], ['St. Marks', '32355'], ['Medart', '32327'], ['Tallahassee', '32305']]
const DOGS = ['No dog', 'No dog', 'No dog', 'Friendly dog', 'Dog — keep gate closed']
const IRRIGATION = ['None', 'None', 'Sprinkler zones', 'Drip beds only']

/** Small deterministic PRNG (mulberry32): same seed, same sequence. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
/** (850) 555-01NN — NN 20..99 for customers (00-19 are the company and staff). */
const phoneN = (n: number) => `(850) 555-01${String(20 + (n % 80)).padStart(2, '0')}`

const COMMERCIAL: Array<{ key: string; name: string; contact: string; sites: Array<[string, string, number]> }> = [
  { key: 'harbor', name: 'Harborview Condominium Association', contact: 'Property manager', sites: [['Clubhouse & pool', '120 Bayshore Dr', 31000], ['Building A common grounds', '122 Bayshore Dr', 18000], ['Building B common grounds', '124 Bayshore Dr', 17000]] },
  { key: 'pelican', name: 'Pelican Point Dental Group', contact: 'Office manager', sites: [['Main office', '2210 Crawfordville Hwy', 9000], ['Second office', '480 Shadeville Rd', 7000], ['Parking lot (wash)', '2212 Crawfordville Hwy', 12000], ['Back lot', '482 Shadeville Rd', 5000]] },
  { key: 'tidewater', name: 'Tidewater Self Storage', contact: 'Site manager', sites: [['Front lot', '3300 Coastal Hwy', 14000], ['North lot', '3302 Coastal Hwy', 11000]] },
]

export type DemoDataset = ReturnType<typeof buildDemoDataset>

export function buildDemoDataset(today: string) {
  const r = rng(20261111)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]

  const customers: DemoCustomer[] = []

  // The portal customer is always first: the one we show the portal with.
  const names: Array<[string, string]> = []
  const used = new Set<string>()
  names.push(['Dana', 'Whitfield'])
  used.add('Dana Whitfield')
  while (names.length < 37) {
    const f = pick(FIRST)
    const l = pick(LAST)
    if (used.has(`${f} ${l}`)) continue
    used.add(`${f} ${l}`)
    names.push([f, l])
  }
  names.forEach(([f, l], i) => {
    const [city, zip] = TOWNS[i % TOWNS.length]
    const dog = i === 0 ? 'Friendly dog' : pick(DOGS)
    const gate = r() < 0.3 ? String(1000 + Math.floor(r() * 8999)) : null
    customers.push({
      key: `res-${i + 1}`,
      name: `${f} ${l}`,
      email: `${slug(`${f}.${l}`)}@${DEMO_MAIL_DOMAIN}`,
      phone: phoneN(i),
      commercial: false,
      properties: [
        {
          label: null,
          address_line1: `${100 + Math.floor(r() * 9800)} ${STREETS[i % STREETS.length]}`,
          city,
          state: 'FL',
          zip,
          lawnSqft: 4000 + Math.floor(r() * 18) * 1000,
          gate,
          dog,
          irrigation: pick(IRRIGATION),
          access_notes: gate ? `Gate code ${gate} (see field)` : dog === 'Dog — keep gate closed' ? 'Dog in the back yard — close the gate' : null,
        },
      ],
    })
  })
  COMMERCIAL.forEach((c, i) => {
    const [city, zip] = TOWNS[i % 3]
    customers.push({
      key: `com-${c.key}`,
      name: c.name,
      email: `${c.key}@${DEMO_MAIL_DOMAIN}`,
      phone: phoneN(40 + i),
      commercial: true,
      properties: c.sites.map(([label, line1, sqft], j) => ({
        label,
        address_line1: line1,
        city,
        state: 'FL' as const,
        zip,
        lawnSqft: sqft,
        gate: j === 0 ? String(2000 + i * 111) : null,
        dog: 'No dog',
        irrigation: j === 0 ? 'Sprinkler zones' : 'None',
        access_notes: j === 0 ? 'Check in with the front desk before starting' : null,
      })),
    })
  })

  /** The Monday of the week `today` falls in, and offsets from it. */
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay() // 0 = Sunday
  const monday = addDaysYmd(today, -((dow + 6) % 7))
  const day = (n: number) => addDaysYmd(today, n)

  // Plan templates: per-visit weekly mowing (seasonal), biweekly shoulder, monthly winter, quarterly wash, care-style inspection plan.
  const templates = [
    {
      name: 'Weekly mowing (seasonal)',
      trade: 'Lawn care',
      description: 'Mow, edge, trim and blow. Weekly April to October, every 2 weeks in March and November, monthly in winter.',
      seasons: [
        { from: '03-01', to: '03-31', frequency: 'every_2_weeks' },
        { from: '04-01', to: '10-31', frequency: 'weekly' },
        { from: '11-01', to: '11-30', frequency: 'every_2_weeks' },
        { from: '12-01', to: '02-29', frequency: 'monthly' },
      ],
      billing_basis: 'per_visit',
      taxable: false,
      tiers: [
        { key: 'small', label: 'Small yard (up to 8,000 sq ft)', price: 45, max: 8000 },
        { key: 'standard', label: 'Standard yard (up to 16,000 sq ft)', price: 65, max: 16000 },
        { key: 'large', label: 'Large yard (up to 40,000 sq ft)', price: 110, max: 40000 },
      ],
    },
    {
      name: 'Biweekly mowing (shoulder season)',
      trade: 'Lawn care',
      description: 'Every other week all year — for yards that grow slowly or customers who like it shaggy.',
      seasons: [{ from: '01-01', to: '12-31', frequency: 'every_2_weeks' }],
      billing_basis: 'per_visit',
      taxable: false,
      tiers: [
        { key: 'small', label: 'Small yard (up to 8,000 sq ft)', price: 55, max: 8000 },
        { key: 'standard', label: 'Standard yard (up to 16,000 sq ft)', price: 75, max: 16000 },
        { key: 'large', label: 'Large yard (up to 40,000 sq ft)', price: 125, max: 40000 },
      ],
    },
    {
      name: 'Monthly winter check-in',
      trade: 'Lawn care',
      description: 'One visit a month through winter: leaves, edging and a look at the beds.',
      seasons: [{ from: '01-01', to: '12-31', frequency: 'monthly' }],
      billing_basis: 'per_month',
      taxable: false,
      tiers: [{ key: 'standard', label: 'Monthly visit', price: 80, max: 40000 }],
    },
    {
      name: 'Quarterly pressure wash',
      trade: 'Soft wash / pressure washing',
      description: 'Driveway, walkways and patio washed every quarter. Taxable service.',
      seasons: [
        { from: '01-01', to: '01-31', frequency: 'monthly' },
        { from: '04-01', to: '04-30', frequency: 'monthly' },
        { from: '07-01', to: '07-31', frequency: 'monthly' },
        { from: '10-01', to: '10-31', frequency: 'monthly' },
      ],
      billing_basis: 'per_visit',
      taxable: true,
      tiers: [{ key: 'standard', label: 'Driveway + walks', price: 195, max: 40000 }],
    },
    {
      name: 'Yard & roof care inspection plan',
      trade: 'Clean-up',
      description: 'Twice a year: debris cleared from beds and roof edges, then an inspector rates the roofline (green / yellow / red).',
      seasons: [
        { from: '04-01', to: '04-30', frequency: 'monthly' },
        { from: '11-01', to: '11-30', frequency: 'monthly' },
      ],
      billing_basis: 'per_month',
      taxable: true,
      tiers: [{ key: 'standard', label: 'Standard home', price: 95, max: 40000 }],
    },
  ] as const

  // Who gets which plan: residential 1..26 weekly (some biweekly), 5 quarterly wash, 6 inspection plan, commercial accounts mow + wash.
  const planAssignments: Array<{ customerKey: string; propertyIndex: number; template: number; crew: 'mow-a' | 'wash-b'; weekday: number; startWeeksAgo: number; status?: 'paused' }> = []
  customers.forEach((c, i) => {
    if (c.commercial) {
      c.properties.forEach((_, p) => planAssignments.push({ customerKey: c.key, propertyIndex: p, template: 0, crew: 'mow-a', weekday: 1 + (p % 3), startWeeksAgo: 8 }))
      planAssignments.push({ customerKey: c.key, propertyIndex: 0, template: 3, crew: 'wash-b', weekday: 4, startWeeksAgo: 8 })
      return
    }
    if (i < 22) planAssignments.push({ customerKey: c.key, propertyIndex: 0, template: 0, crew: 'mow-a', weekday: 1 + (i % 5), startWeeksAgo: 8 })
    else if (i < 28) planAssignments.push({ customerKey: c.key, propertyIndex: 0, template: 1, crew: 'mow-a', weekday: 1 + (i % 5), startWeeksAgo: 8 })
    if (i >= 8 && i < 13) planAssignments.push({ customerKey: c.key, propertyIndex: 0, template: 3, crew: 'wash-b', weekday: 4, startWeeksAgo: 8 })
    if (i >= 14 && i < 20) planAssignments.push({ customerKey: c.key, propertyIndex: 0, template: 4, crew: 'wash-b', weekday: 5, startWeeksAgo: 8 })
  })

  return {
    today,
    monday,
    customers,
    templates,
    planAssignments,
    /** Visit outcomes by calendar day offset: how the last 6 weeks went. Applied to visits that fall in the past. */
    visitOutcomes: {
      skipReasons: ['Customer asked us to skip — out of town', 'Gate locked, no answer at the door', 'Standing water after the storm', 'Customer on vacation', 'Heavy rain — lawn too wet to cut'],
      /** The "rain day": every visit scheduled on this day (≈ 3 weeks back) was moved one day later in one batch. */
      rainDay: day(-21),
      rainDayMoveTo: day(-20),
      photoPlaceholders: ['before-front-yard.jpg', 'after-front-yard.jpg', 'edging-detail.jpg'],
    },
    /** Hourly grading job: a tractor and a crew lead, billed by the hour. */
    grading: {
      customerKey: 'res-5',
      title: 'Driveway & pad grading — 2 days',
      days: [
        { ymd: day(-9), crewHours: [[7.5, 16.0], [8.25, 16.5]] as Array<[number, number]>, tractor: [7.75, 15.75] as [number, number] },
        { ymd: day(-8), crewHours: [[7.5, 15.0], [8.0, 15.5]] as Array<[number, number]>, tractor: [7.75, 14.75] as [number, number] },
      ],
      estimatedHours: 18,
    },
    pricebook: [
      { name: 'Crew labor (per hour)', unit: 'hour', price: 55, labor: true },
      { name: 'Tractor with operator (per hour)', unit: 'hour', price: 95, labor: false, equipment: true },
      { name: 'Skid steer (per hour)', unit: 'hour', price: 85, labor: false, equipment: true },
    ],
    vendors: [
      { name: 'Panhandle Turf & Ag Supply', contact: 'Counter sales', phone: '(850) 555-0150', email: `orders@${DEMO_MAIL_DOMAIN}` },
      { name: 'Bayou Mulch & Stone', contact: 'Dispatch', phone: '(850) 555-0151', email: `dispatch@${DEMO_MAIL_DOMAIN}` },
    ],
    quotes: ([
      { key: 'sent', customerKey: 'res-9', title: 'Front-yard refresh', status: 'sent', daysAgo: 3, expiresInDays: 11, lines: [{ name: 'Mulch install (3 yd)', qty: 3, unit: 'cubic yard', price: 85 }, { name: 'Shrub trimming', qty: 1, unit: 'visit', price: 140 }, { name: 'Sod patch — 400 sq ft', qty: 400, unit: 'sq ft', price: 1.1, optional: true }, { name: 'Pressure wash walkway', qty: 1, unit: 'visit', price: 160, optional: true, defaultOn: true }] },
      { key: 'approved', customerKey: 'res-12', title: 'Backyard drainage + sod', status: 'accepted', daysAgo: 12, expiresInDays: 18, depositPercent: 25, lines: [{ name: 'Drainage swale regrade', qty: 1, unit: 'job', price: 1450 }, { name: 'Sod — 1,200 sq ft', qty: 1200, unit: 'sq ft', price: 1.05 }] },
      { key: 'expired', customerKey: 'res-17', title: 'Landscape bed rebuild', status: 'sent', daysAgo: 45, expiresInDays: -15, lines: [{ name: 'Bed edging + mulch', qty: 1, unit: 'job', price: 980 }, { name: 'Native plant package', qty: 1, unit: 'job', price: 640 }] },
    ] as DemoQuote[]),
    threads: [
      { customerKey: 'res-1', team: 'Dana wants the gate closed behind us — dog in the yard. Added it to the property.', portal: ['Hi! Can you skip next week? We are at the beach.', 'Thanks for letting us know — we marked next Tuesday as skipped. See you the week after.'] },
      { customerKey: 'res-4', team: 'Customer prefers text over calls. Texting OK on file.', portal: ['Is it possible to add edging along the driveway?', 'Yes — we added edging to the visit notes for next time at no extra charge.'] },
      { customerKey: 'res-9', team: 'Sent the front-yard quote. Follow up Thursday if no reply.', portal: [] as string[] },
    ],
    payWeek: { weekStart: monday },
  }
}

/** A customer's email / phone must be fictional: used by the seed's last check and by tests. */
export function isFictionalEmail(e: string | null | undefined): boolean {
  return !!e && new RegExp(`@${DEMO_MAIL_DOMAIN.replace(/\./g, '\\.')}$`, 'i').test(e)
}
export function isFictionalPhone(p: string | null | undefined): boolean {
  return !!p && /^\(850\) 555-01\d\d$/.test(p)
}

/** The seed input for the demo company, in the same raw shape as a seed JSON file (validated by parseCompanySeedInput). */
export function demoSeedRaw(opts: { name?: string | null; profile?: string | null } = {}): Record<string, unknown> {
  return {
    org: { name: opts.name?.trim() || DEMO_DEFAULTS.name, phone: DEMO_DEFAULTS.phone, email: DEMO_DEFAULTS.email, address: DEMO_DEFAULTS.address, subdomain: DEMO_DEFAULTS.subdomain },
    brand: { shortName: opts.name?.trim() || 'Gulf Coast Grounds', website: 'https://demo.example.com', serviceArea: 'Wakulla County and nearby' },
    profile: opts.profile || DEMO_DEFAULTS.profile,
    owner: { email: DEMO_DEFAULTS.ownerEmail, fullName: DEMO_DEFAULTS.ownerName, phone: '(850) 555-0101' },
    demo: true,
  }
}
