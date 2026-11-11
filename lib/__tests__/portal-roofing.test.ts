/** @jest-environment node */
/**
 * Customer portal for roofing (job-based) customers: progress stages from the existing single sources, install dates ("Week of" then
 * the exact day), hidden-by-default job photos, paperwork, balance / financed, checkups, invite-only sign-in, and isolation between
 * two customers of the same company.
 */
import { createFakeDb } from '@/lib/test-helpers/fake-db'

process.env.SMTP_HOST = 'smtp.test'
process.env.PORTAL_REQUEST_MIN_MS = '0'
const R = 'org-roof'
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
const day = (d: number) => iso(d).slice(0, 10)

let mockCookie: string | undefined
let mockStaff: { orgId: string; userId: string; ownerLike: boolean; managerLike: boolean; jobBoard: boolean } | null
const mails: Array<{ to: string; subject: string; text: string; html: string }> = []
let db: ReturnType<typeof createFakeDb>

jest.mock('next/headers', () => ({ cookies: () => ({ get: (n: string) => (n === 'portal_session' && mockCookie ? { name: n, value: mockCookie } : undefined) }), headers: () => new Headers() }))
jest.mock('@/lib/company-host-server', () => ({ getRequestHostFence: async () => ({ kind: 'org', orgId: R, source: 'host' }) }))
jest.mock('@/lib/org-features-server', () => ({ isOrgFeatureOn: async () => true }))
jest.mock('@/lib/company-links', () => ({ orgAppUrl: async (org: string) => `https://${org}.crm.test`, tryOrgAppUrl: async (org: string) => `https://${org}.crm.test` }))
jest.mock('@/lib/setter-email', () => ({
  getCrmEmailFrom: () => 'Co <info@co.test>',
  getMailTransport: () => ({ sendMail: async (m: { to: string; subject: string; text: string; html: string }) => { mails.push(m) } }),
}))
jest.mock('@/lib/org-brand', () => ({ getDocumentBrand: async () => ({ name: 'Summit Roofing LLC', casualName: 'Summit Roofing', phone: '555-0100', email: 'office@summit.test' }) }))
jest.mock('@/lib/company-recipient', () => ({ resolveCompanyInboxEmail: async () => 'office@summit.test' }))
jest.mock('@/lib/cron-orgs', () => ({ loadOrgTimeZone: async () => 'America/New_York' }))
jest.mock('@/lib/org-trades', () => ({
  loadOrgTrades: async () => [],
  tradeLabel: (s: string | null) => ({ roofing: 'Roof', gutters: 'Gutters' } as Record<string, string>)[String(s)] ?? String(s),
}))
jest.mock('@/lib/supplier-orders', () => ({
  loadJobMaterialsState: async (_a: unknown, _o: string, jobId: string, stored: string | null) =>
    (jest.requireActual('@/lib/job-materials-state') as typeof import('@/lib/job-materials-state')).deriveMaterialsState({ stored: jobId === 'j-ordered' ? 'ordered' : stored }),
}))
jest.mock('@/lib/threads/api', () => ({
  threadAuth: async () => {
    if (!mockStaff) return new (jest.requireActual('next/server').NextResponse)(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    return { admin: db.client, viewer: mockStaff }
  },
}))

import { buildJobStages, exactDateDays, installWhen, mondayOf } from '@/lib/portal/job-stages'
import { findPortalFile, loadPortalHome } from '@/lib/portal/data'
import { inviteCustomerToPortal, removeCustomerPortalAccess } from '@/lib/portal/invite'
import { getPortalSession, requestLoginLink, startPortalSession } from '@/lib/portal/server'
import { portalSettingsOf, parsePortalSettingsPatch } from '@/lib/portal/settings'
import { POST as invitePOST, DELETE as inviteDELETE } from '@/app/api/customers/[id]/portal-invite/route'
import { PATCH as sharePATCH } from '@/app/api/portal-sharing/route'
import { BASE_TERMS } from '@/lib/industry-profiles'

const SECRET = ['COST-9911', 'COMMISSION-9911', 'DEALER-FEE-9911', 'INTERNAL-NOTE-9911', 'OTHER-CUSTOMER-9911']
const tok = (c: string) => c.repeat(64)

function seed() {
  const job = (id: string, cust: string, status: string, extra: Record<string, unknown> = {}) => ({
    id, org_id: R, customer_id: cust, status, address_text: `${id} Ridge Rd`, scheduled_date: null, materials_status: 'not_ordered', sale_amount: 10000,
    allow_close_with_balance: false, close_balance_by: null, project_id: null, linked_proposal_id: null, accepted_proposal_id: null, created_at: iso(-10),
    internal_notes: 'INTERNAL-NOTE-9911', material_cost: 'COST-9911', commission_pre_tax_subtotal: 'COMMISSION-9911', dealer_fee_amount: 'DEALER-FEE-9911', portal_show_crew_photos: false, ...extra,
  })
  const photo = (id: string, jobId: string, extra: Record<string, unknown> = {}) => ({
    id, org_id: R, job_id: jobId, work_order_id: null, photo_tag: null, caption: null, filename: `${id}.jpg`, mime_type: 'image/jpeg', storage_path: `R/${id}.jpg`, shared_with_customer: false, deleted_at: null, created_at: iso(-2), ...extra,
  })
  return {
    orgs: [{ id: R, settings: {}, email: 'office@summit.test' }],
    customers: [
      { id: 'r1', org_id: R, name: 'Riley One', email: 'riley@x.test', phone: '850-111-1111', portal_invited_at: iso(-1) },
      { id: 'r2', org_id: R, name: 'Sam Two', email: 'sam@x.test', phone: '850-222-2222', portal_invited_at: null },
      { id: 'r3', org_id: R, name: 'Noemail Three', email: null, phone: '850-333-3333', portal_invited_at: null },
    ],
    opportunities: [{ id: 'opp-r1', org_id: R, customer_id: 'r1' }, { id: 'opp-r2', org_id: R, customer_id: 'r2' }],
    production_jobs: [
      job('j-main', 'r1', 'scheduled', { scheduled_date: day(2), sale_amount: 10000 }),
      job('j-ordered', 'r1', 'materials', { sale_amount: 5000 }),
      job('j-cancel', 'r1', 'cancelled'),
      job('j-hold', 'r1', 'on_hold'),
      job('j-r2', 'r2', 'sold', { sale_amount: 777 }),
    ],
    work_orders: [
      { id: 'wo-roof', org_id: R, job_id: 'j-main', trade: 'roofing', status: 'scheduled', scheduled_date: day(2), work_order_type: 'install', crew_link_token: 'CREW-TOKEN' },
      { id: 'wo-gut', org_id: R, job_id: 'j-main', trade: 'gutters', status: 'scheduled', scheduled_date: day(9), work_order_type: 'install' },
      { id: 'wo-cancelled', org_id: R, job_id: 'j-main', trade: 'siding', status: 'cancelled', scheduled_date: day(4), work_order_type: 'install' },
      { id: 'wo-r2', org_id: R, job_id: 'j-r2', trade: 'roofing', status: 'scheduled', scheduled_date: day(1), work_order_type: 'install' },
    ],
    job_payments: [{ id: 'pay1', job_id: 'j-main', amount_cents: 400000 }, { id: 'pay2', job_id: 'j-r2', amount_cents: 1 }],
    job_invoices: [{ id: 'inv-main', org_id: R, customer_id: null, job_id: 'j-main', invoice_number: 'INV-1', status: 'sent', total_cents: 600000, issued_at: iso(-1), due_at: iso(5), created_at: iso(-1) }],
    invoice_payments: [],
    order_form_contracts: [
      { id: 'c-fin', org_id: R, opportunity_id: 'opp-r1', project_address: 'j-main Ridge Rd', project_cost: 10000, status: 'completed', signing_token: 'a1a1a1a1-0000-4000-8000-000000000001', token_expires_at: iso(-3), created_at: iso(-20), payment_method: 'finance', finance_company: 'Hearth' },
    ],
    job_change_orders: [
      { id: 'co-1', org_id: R, job_id: 'j-main', co_number: 'CO-001', status: 'completed', signing_token: tok('a'), signed_at: iso(-3), created_at: iso(-4) },
      { id: 'co-pending', org_id: R, job_id: 'j-main', co_number: 'CO-002', status: 'pending_customer', signing_token: tok('b'), signed_at: null, created_at: iso(-1) },
      { id: 'co-r2', org_id: R, job_id: 'j-r2', co_number: 'OTHER-CUSTOMER-9911', status: 'completed', signing_token: tok('c'), signed_at: iso(-3), created_at: iso(-4) },
    ],
    inspection_reports: [
      { id: 'ir-sent', org_id: R, opportunity_id: 'opp-r1', status: 'sent', share_token: tok('d'), created_at: iso(-30) },
      { id: 'ir-draft', org_id: R, opportunity_id: 'opp-r1', status: 'draft', share_token: tok('e'), created_at: iso(-30) },
      { id: 'ir-r2', org_id: R, opportunity_id: 'opp-r2', status: 'sent', share_token: tok('f'), created_at: iso(-30) },
    ],
    documents: [
      { id: 'doc-warranty', org_id: R, customer_id: null, job_id: 'j-main', title: 'Warranty', filename: 'w.pdf', storage_path: 'R/w.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-2) },
      { id: 'doc-claim', org_id: R, customer_id: null, job_id: 'j-main', title: 'Insurance claim estimate', filename: 'claim.pdf', storage_path: 'R/claim.pdf', shared_with_customer: false, status: 'active', deleted_at: null, created_at: iso(-2) },
    ],
    photos: [
      photo('ph-crew-front', 'j-main', { work_order_id: 'wo-roof', photo_tag: 'final_front' }),
      photo('ph-crew-other', 'j-main', { work_order_id: 'wo-roof', photo_tag: 'other_final' }),
      photo('ph-crew-job-level', 'j-main', { work_order_id: null, photo_tag: 'final_back' }),
      photo('ph-staff', 'j-main', { shared_with_customer: true, caption: 'Ridge detail' }),
      photo('ph-private', 'j-main'),
      photo('ph-deleted', 'j-main', { shared_with_customer: true, deleted_at: iso(-1) }),
      photo('ph-r2', 'j-r2', { shared_with_customer: true, caption: 'OTHER-CUSTOMER-9911' }),
    ],
    job_checkups: [
      { id: 'k1', org_id: R, production_job_id: 'j-main', kind: 'inspection', due_on: day(20), status: 'due', booked_for: null, result: 'red', notes: 'INTERNAL-NOTE-9911' },
      { id: 'k2', org_id: R, production_job_id: 'j-main', kind: 'touch', due_on: day(-300), status: 'done', booked_for: null },
      { id: 'k-r2', org_id: R, production_job_id: 'j-r2', kind: 'touch', due_on: day(10), status: 'due', booked_for: null },
    ],
    activities: [],
    threads: [],
    properties: [],
    service_plans: [],
    payment_links: [],
  }
}

const rpc = {
  portal_find_customers: (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) =>
    t.customers.filter((c) => c.org_id === args.p_org && args.p_email && String(c.email ?? '').trim().toLowerCase() === args.p_email).map((c) => ({ id: c.id, name: c.name, email: c.email })),
  portal_take_attempt: (args: Record<string, unknown>, t: Record<string, Array<Record<string, unknown>>>) => {
    const rows = (t.portal_rate_limits ??= [])
    let r = rows.find((x) => x.key === args.p_key) as { key: unknown; attempts: number } | undefined
    if (!r) rows.push((r = { key: args.p_key, attempts: 0 }))
    r.attempts += 1
    return r.attempts <= Number(args.p_limit)
  },
}

beforeEach(() => {
  mockCookie = undefined
  mockStaff = { orgId: R, userId: 'staff-1', ownerLike: true, managerLike: true, jobBoard: true }
  mails.length = 0
  db = createFakeDb(seed() as never, { rpc: rpc as never })
})

const admin = () => db.client
async function homeOf(cust: string) {
  db.tables.customers.find((c) => c.id === cust)!.portal_invited_at ??= iso(-1) // these tests are about what a signed-in customer sees
  const s = await startPortalSession(admin(), R, cust)
  mockCookie = s.token
  const sess = await getPortalSession(admin())
  if (!sess) throw new Error('no session')
  return { sess, home: (await loadPortalHome(admin(), sess))! }
}
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://${R}.crm.test/api/x`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('progress stages (one source each, no status column of our own)', () => {
  const stage = (status: string, o: Partial<Parameters<typeof buildJobStages>[0]> = {}, terms = BASE_TERMS) =>
    buildJobStages({ status, materialsKey: 'not_ordered', hasScheduledTrade: false, paidInFull: false, ...o }, terms).map((s) => `${s.key}:${s.state}`).join(' ')
  test('sold: signed, materials is next', () => expect(stage('sold')).toBe('sold:done materials:current scheduled:todo installed:todo complete:todo'))
  test('supplier orders move materials without the status moving', () => expect(stage('sold', { materialsKey: 'ordered' })).toBe('sold:done materials:done scheduled:current installed:todo complete:todo'))
  test('partly ordered is still ordering', () => expect(stage('materials', { materialsKey: 'partial' })).toContain('materials:current'))
  test('a booked crew day makes it scheduled (earlier steps follow)', () => expect(stage('materials', { hasScheduledTrade: true })).toBe('sold:done materials:done scheduled:done installed:current complete:todo'))
  test('installed but not paid: last step is current; paid in full completes it', () => {
    expect(stage('complete')).toBe('sold:done materials:done scheduled:done installed:done complete:current')
    expect(stage('collected', { paidInFull: true })).toBe('sold:done materials:done scheduled:done installed:done complete:done')
  })
  test('words come from the profile terms', () => {
    const labels = buildJobStages({ status: 'sold', materialsKey: 'none', hasScheduledTrade: false, paidInFull: false }, { install: 'Build', installed: 'Built' }).map((s) => s.label)
    expect(labels).toEqual(['Signed', 'Materials ordered', 'Build scheduled', 'Built', 'Complete'])
    expect(buildJobStages({ status: 'sold', materialsKey: 'none', hasScheduledTrade: false, paidInFull: false }).map((s) => s.label)[2]).toBe('Install scheduled')
  })
})

describe('install date words', () => {
  test('Monday of the week', () => {
    expect(mondayOf('2026-11-12')).toBe('2026-11-09') // Thursday
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09') // Sunday belongs to the Mon-Sun week
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
  })
  test('week until within N days, then the exact day; a past day says nothing', () => {
    expect(installWhen('2026-11-20', '2026-11-12', 3)).toEqual({ kind: 'week', ymd: '2026-11-16' })
    expect(installWhen('2026-11-15', '2026-11-12', 3)).toEqual({ kind: 'day', ymd: '2026-11-15' })
    expect(installWhen('2026-11-16', '2026-11-12', 3)).toEqual({ kind: 'week', ymd: '2026-11-16' })
    expect(installWhen('2026-11-12', '2026-11-12', 3)).toEqual({ kind: 'day', ymd: '2026-11-12' })
    expect(installWhen('2026-11-11', '2026-11-12', 3)).toBeNull()
    expect(installWhen(null, '2026-11-12')).toBeNull()
    expect(installWhen('junk', '2026-11-12')).toBeNull()
  })
  test('the window is a company setting with a clamp and a default of 3', () => {
    expect(exactDateDays(undefined)).toBe(3)
    expect(exactDateDays(7)).toBe(7)
    expect(exactDateDays(99)).toBe(3)
    expect(exactDateDays(-1)).toBe(3)
    expect(portalSettingsOf({ customerPortal: { exactDateDays: 5 } }).exactDateDays).toBe(5)
    expect(parsePortalSettingsPatch({ exactDateDays: 40 })).toHaveProperty('error')
    expect(parsePortalSettingsPatch({ inviteOnly: 'yes' })).toHaveProperty('error')
    expect(parsePortalSettingsPatch({ exactDateDays: 5, evil: 1 })).toEqual({ set: { exactDateDays: 5 } })
  })
  test('invite-only defaults on for roofing, off for lawn', () => {
    expect(portalSettingsOf({}).inviteOnly).toBe(true)
    expect(portalSettingsOf({ profile: { id: 'lawn_landscape' } }).inviteOnly).toBe(false)
    expect(portalSettingsOf({ profile: { id: 'lawn_landscape' }, customerPortal: { inviteOnly: true } }).inviteOnly).toBe(true)
  })
})

describe('the job card in the portal', () => {
  test('one line per active trade with the company words; cancelled trade not shown; reschedule shows by itself', async () => {
    let { home } = await homeOf('r1')
    const main = home.jobs.find((j) => j.id === 'j-main')!
    expect(main.installs).toEqual([
      { label: 'Roof', when: { kind: 'day', ymd: day(2) }, done: false },
      { label: 'Gutters', when: expect.objectContaining({ kind: 'week' }), done: false },
    ])
    db.tables.work_orders.find((w) => w.id === 'wo-roof')!.scheduled_date = day(12) // ops moved it
    ;({ home } = await homeOf('r1'))
    expect(home.jobs.find((j) => j.id === 'j-main')!.installs[0].when).toEqual(expect.objectContaining({ kind: 'week' }))
  })
  test('stages come from status + schedule; the materials answer is the supplier one', async () => {
    const { home } = await homeOf('r1')
    expect(home.jobs.find((j) => j.id === 'j-main')!.stages.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'todo'])
    expect(home.jobs.find((j) => j.id === 'j-ordered')!.stages.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
  })
  test('cancelled and on-hold jobs have no stages, no money, no schedule: just the address', async () => {
    const { home } = await homeOf('r1')
    for (const id of ['j-cancel', 'j-hold']) expect(home.jobs.find((j) => j.id === id)).toEqual({ id, address: `${id} Ridge Rd`, quiet: true, stages: [], installs: [], money: null })
    expect(JSON.stringify(home.jobs.filter((j) => j.quiet).map((j) => [j.stages, j.installs, j.money]))).not.toMatch(/cancel|hold|paus/i)
  })
  test('financed: the lender name only, balance of the loan never; money never carries fees, costs or commission', async () => {
    const { home } = await homeOf('r1')
    const main = home.jobs.find((j) => j.id === 'j-main')!
    expect(main.money).toMatchObject({ financedThrough: null }) // no opportunity link for this job -> not guessed
    db.tables.production_jobs.find((j) => j.id === 'j-main')!.project_id = 'proj-1'
    ;(db.tables.projects ??= []).push({ id: 'proj-1', org_id: R, opportunity_id: 'opp-r1' })
    const again = (await homeOf('r1')).home.jobs.find((j) => j.id === 'j-main')!
    expect(again.money?.financedThrough).toBe('Hearth')
    expect(Object.keys(again.money!).sort()).toEqual(['balanceCents', 'financedThrough', 'paidCents', 'paidInFull', 'totalCents'])
  })
  test('balance = what is left of the sale after payments (rounded to cents) and the open invoice gets the Pay button', async () => {
    const { home } = await homeOf('r1')
    const main = home.jobs.find((j) => j.id === 'j-main')!
    expect(main.money).toMatchObject({ totalCents: 1000000, paidCents: 400000, balanceCents: 600000, paidInFull: false })
    expect(home.invoices.find((i) => i.jobId === 'j-main')?.id).toBe('inv-main')
  })
  test('nothing secret ever reaches the home view; no other customer either', async () => {
    const { home } = await homeOf('r1')
    const json = JSON.stringify(home)
    for (const m of SECRET) expect(json).not.toContain(m)
    expect(json).not.toContain('CREW-TOKEN')
    expect(home.jobs.every((j) => ['j-main', 'j-ordered', 'j-cancel', 'j-hold'].includes(j.id))).toBe(true)
    const other = JSON.stringify((await homeOf('r2')).home)
    expect(other).not.toContain('j-main')
  })
  test('checkups: open ones only, no result or notes; another customer sees only theirs', async () => {
    const { home } = await homeOf('r1')
    expect(home.checkups).toEqual([{ id: 'k1', title: 'Checkup', when: day(20), booked: false }])
    expect(JSON.stringify(home.checkups)).not.toMatch(/red|INTERNAL/)
    expect((await homeOf('r2')).home.checkups.map((c) => c.id)).toEqual(['k-r2'])
  })
})

describe('paperwork and documents', () => {
  test('signed change orders + sent inspection report + shared documents; not drafts, pending, claim docs or others', async () => {
    const { home } = await homeOf('r1')
    expect(home.paperwork.map((p) => p.title).sort()).toEqual(['Change order CO-001', 'Inspection report'])
    expect(home.paperwork.find((p) => p.title.startsWith('Change'))!.href).toBe(`/api/files/signed/change-order/${tok('a')}`)
    expect(home.paperwork.find((p) => p.title.startsWith('Inspection'))!.href).toBe(`/r/${tok('d')}`)
    expect(home.documents.filter((d) => d.kind === 'document').map((d) => d.title)).toEqual(['Warranty'])
  })
  test('a cancelled or on-hold job shows nothing of its own, even if a document or photo was ticked earlier', async () => {
    db.tables.documents.push({ id: 'doc-cancel', org_id: R, customer_id: null, job_id: 'j-cancel', title: 'Cancelled job paper', filename: 'c.pdf', storage_path: 'R/c.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: iso(-2) })
    db.tables.photos.push({ id: 'ph-cancel', org_id: R, job_id: 'j-cancel', work_order_id: null, photo_tag: null, caption: null, filename: 'c.jpg', mime_type: 'image/jpeg', storage_path: 'R/c.jpg', shared_with_customer: true, deleted_at: null, created_at: iso(-2) })
    const { home, sess } = await homeOf('r1')
    expect(JSON.stringify(home.documents)).not.toMatch(/Cancelled job paper|ph-cancel/)
    expect(await findPortalFile(admin(), sess, 'document', 'doc-cancel')).toBeNull()
    expect(await findPortalFile(admin(), sess, 'photo', 'ph-cancel')).toBeNull()
  })
  test('a document stays hidden until staff share it', async () => {
    db.tables.documents.find((d) => d.id === 'doc-claim')!.shared_with_customer = true
    const { home } = await homeOf('r1')
    expect(home.documents.map((d) => d.title)).toContain('Insurance claim estimate')
  })
})

describe('job photos: hidden by default', () => {
  const photoIds = async (c = 'r1') => (await homeOf(c)).home.documents.filter((d) => d.kind === 'photo').map((d) => d.id).sort()
  test('only the one staff marked; crew walk-around is NOT shown by default', async () => {
    expect(await photoIds()).toEqual(['ph-staff'])
  })
  test('one tap per job shows the four walk-around angles on trades only (not "other", not job-level, not deleted)', async () => {
    db.tables.production_jobs.find((j) => j.id === 'j-main')!.portal_show_crew_photos = true
    expect(await photoIds()).toEqual(['ph-crew-front', 'ph-staff'])
  })
  test('download follows the same rule, and another customer cannot fetch it', async () => {
    const { sess } = await homeOf('r1')
    expect(await findPortalFile(admin(), sess, 'photo', 'ph-staff')).toEqual({ storagePath: 'R/ph-staff.jpg', filename: 'ph-staff.jpg' })
    expect(await findPortalFile(admin(), sess, 'photo', 'ph-crew-front')).toBeNull()
    expect(await findPortalFile(admin(), sess, 'photo', 'ph-private')).toBeNull()
    expect(await findPortalFile(admin(), sess, 'photo', 'ph-r2')).toBeNull()
    const s2 = (await homeOf('r2')).sess
    expect(await findPortalFile(admin(), s2, 'photo', 'ph-staff')).toBeNull()
    expect(await findPortalFile(admin(), s2, 'photo', 'ph-r2')).not.toBeNull()
  })
  test('staff switches: owner/job board only; unknown ids are 404; writes only the flag', async () => {
    const on = await sharePATCH(req('PATCH', { jobId: '00000000-0000-4000-8000-0000000000aa', crewPhotos: true }))
    expect(on.status).toBe(404)
    db.tables.production_jobs.find((j) => j.id === 'j-main')!.id = '11111111-1111-4111-8111-111111111111'
    expect((await sharePATCH(req('PATCH', { jobId: '11111111-1111-4111-8111-111111111111', crewPhotos: true }))).status).toBe(200)
    expect(db.tables.production_jobs.find((j) => j.customer_id === 'r1' && j.status === 'scheduled')!.portal_show_crew_photos).toBe(true)
    mockStaff = { ...mockStaff!, ownerLike: false, managerLike: true, jobBoard: false }
    expect((await sharePATCH(req('PATCH', { jobId: '11111111-1111-4111-8111-111111111111', crewPhotos: false }))).status).toBe(404)
    expect((await sharePATCH(req('PATCH', { photoId: 'x', shared: true }))).status).toBe(404)
    mockStaff = null
    expect((await sharePATCH(req('PATCH', { photoId: 'x', shared: true }))).status).toBe(401)
  })
})

describe('invite only (the roofing pilot)', () => {
  test('an uninvited customer asking for a link gets nothing (same as a stranger); an invited one gets one email', async () => {
    await requestLoginLink(admin(), R, 'sam@x.test', '1.1.1.1')
    expect(mails).toHaveLength(0)
    await requestLoginLink(admin(), R, 'riley@x.test', '1.1.1.2')
    expect(mails).toHaveLength(1)
    expect(mails[0].to).toBe('riley@x.test')
  })
  test('an existing session of an uninvited customer is refused (fails closed)', async () => {
    const s = await startPortalSession(admin(), R, 'r2')
    mockCookie = s.token
    expect(await getPortalSession(admin())).toBeNull()
  })
  test('Invite emails the link to the address on file, marks them invited, and says how to get a new link later', async () => {
    const r = await inviteCustomerToPortal(admin(), R, 'r2', 'staff-1')
    expect(r).toEqual({ ok: true, sentTo: 'sam@x.test' })
    expect(db.tables.customers.find((c) => c.id === 'r2')!.portal_invited_at).toBeTruthy()
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('Your Summit Roofing account is ready')
    expect(mails[0].text).toMatch(/\/portal\/enter\?t=[A-Za-z0-9_-]{43}/)
    expect(mails[0].text).toContain('https://org-roof.crm.test/portal and enter your email')
    expect(mails[0].html).not.toMatch(/ARX/)
    const s = await startPortalSession(admin(), R, 'r2')
    mockCookie = s.token
    expect(await getPortalSession(admin())).not.toBeNull()
  })
  test('no email on file: refused with a plain reason; unknown customer: 404; hourly cap', async () => {
    expect(await inviteCustomerToPortal(admin(), R, 'r3', 'staff-1')).toMatchObject({ ok: false, status: 409 })
    expect(await inviteCustomerToPortal(admin(), R, 'nope', 'staff-1')).toMatchObject({ ok: false, status: 404 })
    for (let i = 0; i < 3; i++) await inviteCustomerToPortal(admin(), R, 'r2', 'staff-1')
    expect(await inviteCustomerToPortal(admin(), R, 'r2', 'staff-1')).toMatchObject({ ok: false, status: 429 })
  })
  test('Remove access ends the session and the invitation at once', async () => {
    const s = await startPortalSession(admin(), R, 'r1')
    mockCookie = s.token
    expect(await getPortalSession(admin())).not.toBeNull()
    expect(await removeCustomerPortalAccess(admin(), R, 'r1')).toBe(true)
    expect(await getPortalSession(admin())).toBeNull()
    await requestLoginLink(admin(), R, 'riley@x.test', '1.1.1.3')
    expect(mails).toHaveLength(0)
  })
  test('company switched to open sign-in: any customer with an email gets a link', async () => {
    db.tables.orgs[0].settings = { customerPortal: { inviteOnly: false } }
    await requestLoginLink(admin(), R, 'sam@x.test', '1.1.1.4')
    expect(mails).toHaveLength(1)
  })
  test('invite routes: staff only, same-site only, a customer of another company is a 404', async () => {
    const ctx = (id: string) => ({ params: { id } })
    expect((await invitePOST(req('POST', {}, { origin: 'https://evil.test' }), ctx('r2'))).status).toBe(403)
    mockStaff = { ...mockStaff!, ownerLike: false, managerLike: false, jobBoard: false }
    expect((await invitePOST(req('POST'), ctx('r2'))).status).toBe(404)
    mockStaff = null
    expect((await invitePOST(req('POST'), ctx('r2'))).status).toBe(401)
    mockStaff = { orgId: 'org-other', userId: 'u', ownerLike: true, managerLike: true, jobBoard: true }
    expect((await invitePOST(req('POST'), ctx('r2'))).status).toBe(404)
    expect((await inviteDELETE(req('DELETE'), ctx('r2'))).status).toBe(404)
    expect(db.tables.customers.find((c) => c.id === 'r2')!.portal_invited_at).toBeNull()
    mockStaff = { orgId: R, userId: 'staff-1', ownerLike: true, managerLike: true, jobBoard: true }
    expect((await invitePOST(req('POST'), ctx('r2'))).status).toBe(200)
  })
})
