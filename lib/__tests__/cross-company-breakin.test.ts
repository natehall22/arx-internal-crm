/** @jest-environment node */
/**
 * S4 cross-company break-in suite. Signed in as company B's owner (admin + super admin — the most a company user can
 * hold), call EVERY exported method of EVERY app/api route with company A's ids in the path, query and body, and
 * assert: no A data in the response, no A row changed/deleted, no row inserted into A, no storage object / auth user /
 * email / outbound call of A's touched. Harness + fixtures: lib/test-helpers/breakin-harness.ts.
 *
 * A route that cannot be exercised here is listed in NOT_EXERCISED with the reason and the code-read verdict.
 */
import fs from 'node:fs'
import { join, sep } from 'node:path'
import { NextRequest } from 'next/server'
import { __resetCompanyHostCacheForTests } from '@/lib/company-host'
import {
  A_STAMP, ATTACKER_ID, ATTACKER_TOKEN, requestShape, guessValue, type RequestShape, BRAVO_PUBLIC_TOKEN, BRAVO_ROW_ID, ORG_A, ORG_B, SERVICE_KEY, VICTIM_ID, companyTables, createWorld, reachedB, crossReferences, crossings, findings, routePathOf, tablesInCode, walk,
  type Finding, type World, noJobInvoices,
} from '@/lib/test-helpers/breakin-harness'

const ROOT = join(__dirname, '..', '..')
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
process.env.CRON_SECRET = 'cron-secret-the-attacker-does-not-have'
// Online payments: a (test) key so the billing/pay routes run past "Stripe not set up"; every Stripe call is an outbound
// fetch the suite records. The webhook secret is one the attacker does not have.
process.env.STRIPE_SECRET_KEY = 'sk_test_breakin'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_the_attacker_does_not_have'
delete process.env.DEPLOYMENT_ORG_ID
delete process.env.APP_BASE_DOMAIN

/**
 * Every handler is called twice in the `own` mode: first with company B's OWN ids (the control — does this request
 * reach a record at all?), then with company A's ids (the attack). A refusal in the attack only means something when the
 * control reached B's record; the number of handlers whose control reaches a record is ratcheted
 * (scripts/breakin-reach-baseline.json, may only rise).
 */
let target = VICTIM_ID
let targetOrg = ORG_A
/** Id used for every reference field (`*_id` other than `id`). Equals `target` except in the "own record, A's refs" run. */
let refTarget = VICTIM_ID
const TABLES = tablesInCode(ROOT)
const ORG_TABLES = companyTables(ROOT)
let mockWorld: World
let mockReq: { headers: Headers; cookies: Array<{ name: string; value: string }> } = { headers: new Headers(), cookies: [] }

jest.mock('next/headers', () => ({
  headers: () => mockReq.headers,
  cookies: () => ({
    get: (n: string) => mockReq.cookies.find((c) => c.name === n),
    getAll: () => mockReq.cookies,
    has: (n: string) => mockReq.cookies.some((c) => c.name === n),
    set: () => undefined,
    delete: () => undefined,
  }),
  draftMode: () => ({ isEnabled: false }),
}))
jest.mock('next/navigation', () => ({
  redirect: (to: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { digest: `NEXT_REDIRECT;${to}` }) },
  notFound: () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' }) },
  permanentRedirect: (to: string) => { throw new Error(`NEXT_REDIRECT ${to}`) },
  useRouter: () => ({}), usePathname: () => '/', useSearchParams: () => new URLSearchParams(),
}))
jest.mock('nodemailer', () => {
  const t = { sendMail: async (m: unknown) => { mockWorld.outbound.push(`mail ${JSON.stringify(m)}`); return { messageId: 'x' } }, verify: async () => true }
  return { __esModule: true, default: { createTransport: () => t }, createTransport: () => t }
})
jest.mock('@supabase/supabase-js', () => {
  const { ORG_A: A, ORG_B: B, ATTACKER_ID, ATTACKER_TOKEN: TOK, SERVICE_KEY: SK, ownerOf } = jest.requireActual('@/lib/test-helpers/breakin-harness')
  const userFor = (t?: string | null) => (t === TOK ? { id: ATTACKER_ID, email: 'boss@bravo.test', user_metadata: {}, app_metadata: {} } : null)
  return {
    createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
      const bearer = opts?.global?.headers?.Authorization?.replace(/^Bearer /, '') ?? null
      const w = () => mockWorld
      type Data = { from: (t: string) => unknown; rpc: (n: string, a: Record<string, unknown>) => unknown }
      const data = (): Data =>
        key === SK
          ? w().db.client
          : w().db.viewClient((table: string, r: Record<string, unknown>) => {
              const o = ownerOf(table, r)
              if (o !== A && o !== B) return true
              return bearer === TOK && o === B
            })
      const logAdmin = (op: string) => async (...args: unknown[]) => {
        w().authAdmin.push({ op, arg: JSON.stringify(args) })
        return { data: { user: null, users: [], properties: {} }, error: { message: 'auth admin disabled in test' } }
      }
      const bucket = (b: string) => {
        const log = (op: string) => async (...args: unknown[]) => {
          w().storage.push({ bucket: b, op, arg: JSON.stringify(args) })
          const path = typeof args[0] === 'string' ? args[0] : ''
          if (op === 'list' || op === 'createSignedUrls') return { data: [], error: null }
          return { data: { signedUrl: `https://storage.test/${b}/${path}`, path, publicUrl: `https://storage.test/${b}/${path}` }, error: null }
        }
        return {
          upload: log('upload'), download: log('download'), createSignedUrl: log('createSignedUrl'), createSignedUrls: log('createSignedUrls'),
          remove: log('remove'), list: log('list'), move: log('move'), copy: log('copy'), update: log('update'),
          createSignedUploadUrl: log('createSignedUploadUrl'), uploadToSignedUrl: log('uploadToSignedUrl'),
          getPublicUrl: (p: string) => { w().storage.push({ bucket: b, op: 'getPublicUrl', arg: p }); return { data: { publicUrl: `https://storage.test/${b}/${p}` } } },
        }
      }
      return {
        from: (t: string) => data().from(t),
        rpc: (n: string, a: Record<string, unknown>) => data().rpc(n, a),
        storage: { from: bucket },
        auth: {
          getUser: async (t?: string) => { const u = userFor(t ?? bearer); return { data: { user: u }, error: u ? null : { message: 'invalid' } } },
          getSession: async () => ({ data: { session: null }, error: null }),
          signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }),
          signOut: async () => ({ error: null }),
          resetPasswordForEmail: async () => ({ error: null }),
          exchangeCodeForSession: async () => ({ data: {}, error: { message: 'no' } }),
          verifyOtp: async () => ({ data: {}, error: { message: 'no' } }),
          setSession: async () => ({ data: {}, error: { message: 'no' } }),
          updateUser: logAdmin('updateUser(self)'),
          admin: {
            getUserById: logAdmin('getUserById'), listUsers: logAdmin('listUsers'), createUser: logAdmin('createUser'),
            deleteUser: logAdmin('deleteUser'), updateUserById: logAdmin('updateUserById'), inviteUserByEmail: logAdmin('inviteUserByEmail'),
            generateLink: logAdmin('generateLink'), signOut: logAdmin('signOut'),
          },
        },
        channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
        removeChannel: () => undefined,
      }
    },
  }
})

// React's server-only `cache` is missing from the client build jest loads; per-request memo is irrelevant here.
jest.mock('react', () => ({ ...jest.requireActual('react'), cache: (fn: unknown) => fn }))
// ESM-only or native packages jest cannot load; none of them decides who may see what.
jest.mock('jose', () => ({ SignJWT: class { setProtectedHeader() { return this } setIssuedAt() { return this } setIssuer() { return this } async sign() { return 'jwt' } }, importPKCS8: async () => ({}) }))
jest.mock('geotiff', () => ({ fromArrayBuffer: async () => { throw new Error('geotiff disabled in test') } }))
jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document', Page: 'Page', Text: 'Text', View: 'View', Image: 'Image', Link: 'Link', Svg: 'Svg', Path: 'Path', Font: { register: () => undefined, registerHyphenationCallback: () => undefined },
  StyleSheet: { create: (s: unknown) => s }, renderToBuffer: async () => Buffer.from('%PDF-test'), renderToStream: async () => null, pdf: () => ({ toBuffer: async () => Buffer.from('%PDF-test'), toBlob: async () => new Blob(['%PDF']) }),
}))

const realFetch = global.fetch
beforeAll(() => {
  global.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    // Company address lookup (lib/company-host.ts → rpc org_id_for_subdomain): alpha = A, bravo = B.
    if (String(input).endsWith('/rest/v1/rpc/org_id_for_subdomain')) {
      const sub = (JSON.parse(bodyText || '{}') as { p_subdomain?: string }).p_subdomain
      const org = sub === 'alpha' ? ORG_A : sub === 'bravo' ? ORG_B : null
      return new Response(JSON.stringify(org), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    mockWorld?.outbound.push(`fetch ${String(input)} ${bodyText}`)
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})
afterAll(() => {
  global.fetch = realFetch
  delete process.env.APP_BASE_DOMAIN
  __resetCompanyHostCacheForTests()
})

/**
 * Routes this suite does not exercise, with why and what reading the code showed. Everything else is called.
 * Keep the reasons honest: a route only belongs here if calling it with the fake DB proves nothing.
 */
const NOT_EXERCISED: Record<string, string> = {}

const ID_KEYS = [
  'id', 'lead_id', 'leadId', 'job_id', 'jobId', 'opportunity_id', 'opportunityId', 'customer_id', 'customerId', 'deal_id', 'dealId',
  'user_id', 'userId', 'project_id', 'projectId', 'proposal_id', 'proposalId', 'appointment_id', 'appointmentId',
  'work_order_id', 'workOrderId', 'invoice_id', 'invoiceId', 'contract_id', 'contractId', 'change_order_id', 'changeOrderId',
  'report_id', 'reportId', 'file_id', 'fileId', 'photo_id', 'photoId', 'document_id', 'documentId', 'production_job_id',
  'productionJobId', 'sub_id', 'subId', 'subcontractor_id', 'crew_id', 'pricebook_id', 'pricebookId', 'item_id', 'itemId',
  'template_id', 'templateId', 'territory_id', 'territoryId', 'team_id', 'teamId', 'period_id', 'periodId',
  'payroll_period_id', 'comp_plan_id', 'closer_user_id', 'setter_user_id', 'owner_user_id', 'assigned_user_id',
  'target_user_id', 'targetUserId', 'measurement_id', 'measurementId', 'inspection_id', 'activity_id', 'thread_id',
  'payment_id', 'paymentId', 'line_id', 'lineId', 'checkup_id', 'checkupId', 'estimate_id', 'campaign_id', 'saved_report_id',
  'original_appointment_id', 'scheduled_appointment_id', 'roofing_type_id', 'financing_program_id', 'announcement_id',
]
const idBag = () => {
  const o: Record<string, unknown> = {}
  for (const k of ID_KEYS) o[k] = k === 'id' ? target : refTarget
  return o
}
/** Generic fields every write gets, then every field the route's own source reads (`requestShape`), then FIXTURES. */
function bodyFor(routePath: string, method: string, shape: RequestShape): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...idBag(),
    org_id: targetOrg, orgId: targetOrg,
    ids: [target], leadIds: [refTarget], lead_ids: [refTarget], jobIds: [refTarget], job_ids: [refTarget], userIds: [refTarget], user_ids: [refTarget],
    data: idBag(), updates: idBag(), patch: idBag(), item: idBag(), record: idBag(), lead: idBag(), job: idBag(),
    token: BRAVO_PUBLIC_TOKEN, path: `org/${targetOrg}/x.pdf`, storage_path: `org/${targetOrg}/x.pdf`,
    status: 'cancelled', notes: 'bravo was here', name: 'bravo', body: 'bravo', reason: 'other', action: 'delete', type: 'note',
  }
  for (const k of [...shape.body, ...shape.form]) if (!(k in out)) out[k] = guessValue(k, k === 'id' ? target : refTarget, targetOrg)
  if (variant) Object.assign(out, variant(target, refTarget).body ?? {})
  return out
}

/**
 * Request variants for routes the generic guess can't drive (enum values, nested shapes, one route serving several
 * resources), keyed `METHOD /route` or `/route`. Each variant is run as its own control + attack. `id` is the record
 * id (B's in the control, A's in the attack); `ref` the id for reference fields.
 */
type Row = Record<string, unknown>
type Variant = ((id: string, ref: string) => { body?: Record<string, unknown>; query?: Record<string, string> }) & {
  /** Reshape both companies' seed rows for this variant only (before the snapshot), e.g. no-job invoices. */
  seed?: (seed: Record<string, Row[]>) => void
}
const withSeed = (v: Variant, seed: (s: Record<string, Row[]>) => void): Variant => Object.assign(v, { seed })
let variant: Variant | null = null
const each = (field: string, values: string[]): Variant[] => values.map((v) => () => ({ body: { [field]: v }, query: { [field]: v } }))
const TODAY_YMD = new Date().toISOString().slice(0, 10)
const POLYGON = { type: 'Polygon', coordinates: [[[-80.7, 35.4], [-80.6, 35.4], [-80.6, 35.5], [-80.7, 35.4]]] }
const tapAt = () => new Date().toISOString()
let tapSeq = 0
const tap = (body: Record<string, unknown>) => ({ body: { tapId: `bravo-tap-${++tapSeq}-xxxx`, at: tapAt(), deviceNow: tapAt(), ...body } })
// People: B's own crew lead (the seeded crew member, so the control reaches) + the ref (A's person in the attack).
const CLOCK_TAPS: Variant[] = [
  (id, ref) => tap({ action: 'clock_in', workOrderId: ref, userIds: [ATTACKER_ID, ref] }),
  (id, ref) => tap({ action: 'clock_in', jobId: ref, userIds: [ATTACKER_ID, ref] }),
  (id, ref) => tap({ action: 'clock_in', workOrderId: ref, userIds: [ref] }),
  (id, ref) => tap({ action: 'clock_out', userIds: [ATTACKER_ID, ref] }),
  (id, ref) => tap({ action: 'break_start', userIds: [ATTACKER_ID, ref] }),
  (id, ref) => tap({ action: 'equipment_start', workOrderId: ref, pricebookItemId: ref }),
  (id, ref) => tap({ action: 'equipment_stop', entryId: ref }),
  (id, ref) => tap({ action: 'finish_answer', entryId: ref, finishTime: '16:30' }),
]
const jobberRuns = (status: string) => (seed: Record<string, Row[]>) => {
  for (const r of seed.import_runs ?? []) Object.assign(r, { status, checked_at: '2026-11-11T12:00:00Z', summary: { nothingToImport: false } })
  for (const r of seed.import_run_items ?? []) Object.assign(r, { status: status === 'importing' ? 'pending' : 'done', action: 'create', kind: 'customer', rank: 3, seq: 1, target_table: 'customers', applied: {} })
}
const FIXTURES: Record<string, Variant[]> = {
  'POST /api/admin/import/jobber/[runId]': [
    () => ({ body: { action: 'addFile', name: 'clients.csv', text: 'J-ID,Display Name\n2_2,Bravo Client\n' } }),
    (id, ref) => ({ body: { action: 'removeFile', fileId: ref } }),
    (id, ref) => ({ body: { action: 'update', fileId: ref, kind: 'clients', columns: { 'Display Name': 'display_name' } } }),
    () => ({ body: { action: 'update', options: { trade: 'roofing', skipArchived: true } } }),
    () => ({ body: { action: 'check' } }),
    () => ({ body: { action: 'discard' } }),
    withSeed(() => ({ body: { action: 'import' } }), jobberRuns('importing')),
    withSeed(() => ({ body: { action: 'undo' } }), jobberRuns('done')),
    () => ({ body: { action: 'matchFiles', names: ['Bravo Client - Contract.pdf'] } }),
    withSeed((id, ref) => ({ body: { action: 'recordDocuments', documentIds: [ref] } }), jobberRuns('done')),
  ],
  'GET /api/admin/data': each('resource', ['comp_plans', 'regions', 'teams', 'users', 'campaigns', 'scheduling']),
  'POST /api/admin/data': each('resource', ['dashboard_settings', 'proposals', 'region', 'team', 'comp_plan', 'user_comp_plan', 'campaign', 'proposal_template']),
  'PATCH /api/admin/data': each('resource', ['region', 'team', 'comp_plan', 'user', 'campaign', 'dashboard_settings', 'user_hierarchy', 'proposal_template']),
  'DELETE /api/admin/data': each('resource', ['region', 'team', 'comp_plan', 'campaign', 'proposal_template']),
  '/api/admin/incentives': each('resource', ['payout_queue', 'heat_program', 'incentive_cycle', 'incentive_badge', 'user_badge']),
  '/api/admin/pricing': each('type', ['pricebook', 'item', 'pricebook_default', 'org_settings']),
  '/api/admin/proposals': each('type', ['adder', 'percentage', 'template', 'visibility', 'toggle_adder']),
  '/api/admin/settings': each('type', ['job_catch_up', 'features', 'checkups', 'general', 'settings', 'canvass_dispositions', 'inspection_outcomes', 'close_outcomes']),
  'POST /api/admin/announcements': [() => ({ body: { slug: 'bravo-news', title: 'Bravo news', body: 'Bravo body', starts_at: '2026-11-10T00:00:00.000Z', roles: ['admin'] } })],
  'PATCH /api/ops/jobs/[id]/cost-lines/[costLineId]': [() => ({ body: { approved: true } })],
  'PATCH /api/referrals/[id]/status': [() => ({ body: { status: 'qualified' } })],
  'POST /api/feedback/submit': [() => ({ body: { type: 'bug', message: 'Bravo bug' } })],
  'POST /api/founder-week/contacts': [() => ({ body: { kind: 'realtor', category: 'realtor', type: 'realtor' } })],
  'POST /api/mobile/push-token': [() => ({ body: { device_token: 'bravo-device-token' } })],
  'POST /api/referrals/for-new-lead': [(id, ref) => ({ body: { referrer_type: 'customer', referrer_id: ref, referred_lead_id: ref } })],
  'POST /api/canvass/import': [() => ({ body: { leads: [{ address_text: '1 Bravo St', lat: 35.4, lng: -80.6, homeowner_name: 'Bravo Home' }] } })],
  '/api/canvass/roof-age': [() => ({ query: { n: '35.41', s: '35.40', e: '-80.60', w: '-80.61' } })],
  '/api/canvass/solar': [() => ({ query: { n: '35.41', s: '35.40', e: '-80.60', w: '-80.61' } })],
  '/api/canvass/weather': [() => ({ query: { n: '35.41', s: '35.40', e: '-80.60', w: '-80.61' } })],
  'POST /api/close-appointments/submit': [() => ({ body: { outcome: 'sold' } })],
  'POST /api/admin/comp-rates': [() => ({ body: { inspection_rate: 10, manager_override_rate: 1, self_gen_rate: 1 } })],
  'PATCH /api/admin/payroll/bonus-lines/[bonusLineId]/status': [() => ({ body: { status: 'approved' } })],
  'POST /api/admin/canvass-territories': [() => ({ body: { boundary_geojson: POLYGON } })],
  '/api/admin/canvass-territories/[id]': [() => ({ body: { boundary_geojson: POLYGON } })],
  // Service plans + visits (default-OFF module; on for both companies in the seed).
  'POST /api/ops/visits/[id]': [
    () => ({ body: { action: 'done' } }),
    () => ({ body: { action: 'skip', reason: 'rain' } }),
    () => ({ body: { action: 'move', date: TODAY_YMD } }),
    (id, ref) => ({ body: { action: 'assign', subId: ref } }),
    () => ({ body: { action: 'reopen' } }),
  ],
  'POST /api/crew/day/[token]/visits/[id]': [() => ({ body: { action: 'done' } }), () => ({ body: { action: 'skip', reason: 'rain' } })],
  'POST /api/ops/visits/shift': [
    (id, ref) => ({ body: { from: TODAY_YMD, days: 1, subId: ref } }),
    () => ({ body: { from: TODAY_YMD, days: 1, subId: 'all' } }),
    // The preview reads the same selection (customer names, crews): it must stay inside the company too.
    (id, ref) => ({ body: { from: TODAY_YMD, days: 1, subId: ref, preview: true } }),
    () => ({ body: { from: TODAY_YMD, days: 1, subId: 'all', preview: true } }),
    () => ({ body: { from: TODAY_YMD, days: 1, subId: 'all', expectKey: 'x' } }),
  ],
  // Invoices (job and no-job): every PATCH action, record_payment included.
  'PATCH /api/invoices/[invoiceId]': [
    () => ({ body: { action: 'add_item', description: 'Bravo mowing', qty: 1, unit_price_cents: 4500, unit: 'hour', service_date: TODAY_YMD } }),
    (id, ref) => ({ body: { action: 'update_item', item_id: ref, description: 'Bravo edit', qty: 2, unit_price_cents: 100 } }),
    (id, ref) => ({ body: { action: 'delete_item', item_id: ref } }),
    () => ({ body: { action: 'send', email: 'pay@bravo.test' } }),
    () => ({ body: { action: 'record_payment', amount_cents: 100, paid_at: TODAY_YMD, method: 'check', note: 'Bravo' } }),
    () => ({ body: { action: 'void', reason: 'Bravo mistake' } }),
    () => ({ body: { action: 'duplicate' } }),
    () => ({ body: { action: 'update_notes', notes: 'Bravo', public_note: 'Bravo', internal_note: 'Bravo' } }),
    // Invoices with no job (service billing): payment + void go through the customer-invoice path.
    withSeed(() => ({ body: { action: 'record_payment', amount_cents: 100, paid_at: TODAY_YMD, method: 'check', note: 'Bravo' } }), noJobInvoices),
    withSeed(() => ({ body: { action: 'void', reason: 'Bravo mistake' } }), noJobInvoices),
    withSeed(() => ({ body: { action: 'send', email: 'pay@bravo.test' } }), noJobInvoices),
  ],
  'GET /api/invoices/[invoiceId]': [() => ({}), withSeed(() => ({}), noJobInvoices)],
  'POST /api/ops/billing': [(id, ref) => ({ body: { keys: [`v:${ref}`], unitKeys: [`v:${ref}`], visitIds: [ref], grouping: 'visit', includeCurrentMonth: true } })],
  // Time clock: taps name people + a stop/job by id (A's in the attack); office edits; crew setup.
  'POST /api/crew/day/[token]/clock': CLOCK_TAPS,
  'POST /api/time/clock': CLOCK_TAPS,
  'POST /api/admin/time': [(id, ref) => ({ body: { userId: ref, startedAt: `${TODAY_YMD}T12:00:00.000Z`, endedAt: `${TODAY_YMD}T16:00:00.000Z`, kind: 'work', workOrderId: ref, reason: 'Bravo forgot' } })],
  'PATCH /api/admin/time/[id]': [(id, ref) => ({ body: { endedAt: `${TODAY_YMD}T16:00:00.000Z`, jobId: ref, reason: 'Bravo fix' } })],
  'DELETE /api/admin/time/[id]': [() => ({ body: { reason: 'Bravo duplicate' } })],
  'PUT /api/admin/subs/[id]/crew': [(id, ref) => ({ body: { tracksTime: true, members: [{ userId: ref, isLead: true }] } })],
  // New payroll (flag on for these routes only): every write names a week / person / job by id.
  'GET /api/admin/payroll/pay-week': [(id, ref) => ({ query: { period: ref } })],
  'GET /api/admin/payroll/pay-week/csv': [(id, ref) => ({ query: { period: ref } })],
  'POST /api/admin/payroll/pay-week/approve': [(id, ref) => ({ body: { periodId: ref, expectedTotal: 0 } })],
  'POST /api/admin/payroll/pay-week/bonus': [(id, ref) => ({ body: { id: ref, periodId: ref, action: 'approve' } })],
  'POST /api/admin/payroll/pay-week/dispute': [(id, ref) => ({ body: { id: ref, action: 'reply', reply: 'Bravo' } }), (id, ref) => ({ body: { id: ref, action: 'fix', amount: 10, periodId: ref } })],
  'POST /api/admin/payroll/pay-week/email': [(id, ref) => ({ body: { periodId: ref } })],
  'POST /api/admin/payroll/pay-week/hours': [(id, ref) => ({ body: { periodId: ref, userId: ref, regularHours: 8, overtimeHours: 0 } })],
  'GET /api/admin/payroll/pay-week/job-split': [(id, ref) => ({ query: { periodId: ref, jobId: ref } })],
  'POST /api/admin/payroll/pay-week/job-split': [(id, ref) => ({ body: { periodId: ref, jobId: ref, lines: [], added: [{ userId: ref, percent: 10 }], reason: 'Bravo split' } })],
  'POST /api/admin/payroll/pay-week/minimum': [(id, ref) => ({ body: { periodId: ref, userId: ref, met: true } })],
  'POST /api/admin/payroll/pay-week/schedule': [
    () => ({ body: { preview: true, schedule: { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null } } }),
    () => ({ body: { schedule: { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null } } }),
  ],
  'PATCH /api/service-plans/[id]': [
    () => ({ body: { action: 'pause' } }),
    () => ({ body: { action: 'resume' } }),
    () => ({ body: { action: 'end', on: TODAY_YMD } }),
    () => ({ body: { preview: true, price: 55 } }),
    () => ({ body: { price: 55 } }),
  ],
}

/** A real 1x1 PNG, so upload routes that sniff the file get past their checks. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const FILE_FIELDS = ['file', 'files', 'photo', 'image', 'logo', 'attachment', 'document', 'upload']

/**
 * How company B reaches the app. `own` = B's own token on an unfenced address (the strongest position: auth succeeds,
 * so every refusal below comes from the route's own org checks). `a-address` = B's token on company A's web address
 * (host routing on). `a-code` = B's token with the iPhone header `X-Company-Code: alpha` (host routing on, legacy
 * host). In the last two the company fence (lib/company-host.ts) should refuse B before any route code runs.
 */
type Mode = { name: string; host: string; baseDomain?: string; code?: string }
const MODES: Mode[] = [
  { name: 'own', host: 'bravo.crm.test' },
  { name: 'a-address', host: 'alpha.crm.test', baseDomain: 'crm.test' },
  { name: 'a-code', host: 'legacy.example', baseDomain: 'crm.test', code: 'alpha' },
]
let mode: Mode = MODES[0]

type Outcome = {
  mode: string; route: string; method: string; status: number | 'threw' | 'timeout'; error?: string; findings: Finding[]; xref: string[]; readA: boolean
  rpcA: string[]; reached: boolean; controlStatus?: number | 'threw' | 'timeout'; controlText?: string
}
const outcomes: Outcome[] = []

const routeFiles = walk(join(ROOT, 'app', 'api')).filter((f) => f.endsWith(`route.ts`)).sort()
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function urlFor(routePath: string, shape?: RequestShape) {
  const params: Record<string, string | string[]> = {}
  const path = routePath.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_m, rest, name: string) => {
    // A [token] gets B's own valid public token, so token routes resolve B's record and the A ids elsewhere in the
    // request test whether a link can be walked to another company's records. [kind] = a real signed-document kind.
    const v = name === 'orgId' ? targetOrg : /token/i.test(name) ? BRAVO_PUBLIC_TOKEN : name === 'kind' ? 'change-order' : target
    params[name] = rest ? [v] : v
    return v
  })
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(idBag())) qs.set(k, String(v))
  for (const k of shape?.query ?? []) if (!qs.has(k)) { const v = guessValue(k, k === 'id' ? target : refTarget, targetOrg); qs.set(k, Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v)) }
  if (variant) for (const [k, v] of Object.entries(variant(target, refTarget).query ?? {})) qs.set(k, v)
  qs.set('org_id', targetOrg)
  qs.set('orgId', targetOrg)
  qs.set('token', BRAVO_PUBLIC_TOKEN)
  qs.set('path', `org/${targetOrg}/x.pdf`)
  return { url: `https://${mode.host}${path}?${qs}`, params }
}

const EMPTY_SHAPE: RequestShape = { body: [], query: [], form: [], multipart: false }

async function attack(
  handler: (req: NextRequest, ctx: { params: Record<string, unknown> }) => Promise<Response>, method: string, routePath: string,
  kind: 'json' | 'form', shape: RequestShape = EMPTY_SHAPE
) {
  const { url, params } = urlFor(routePath, shape)
  const cookieValue = encodeURIComponent(JSON.stringify({ access_token: ATTACKER_TOKEN }))
  const headers = new Headers({
    authorization: `Bearer ${ATTACKER_TOKEN}`,
    cookie: `sb-proj-auth-token=${cookieValue}`,
    host: mode.host,
  })
  if (mode.code) headers.set('x-company-code', mode.code)
  let payload: BodyInit | undefined
  if (method !== 'GET') {
    const b = bodyFor(routePath, method, shape)
    if (kind === 'json') {
      headers.set('content-type', 'application/json')
      payload = JSON.stringify(b)
    } else {
      // Real multipart: every field as text, and a real PNG under each name upload routes use (plus the route's own).
      const fd = new FormData()
      for (const [k, v] of Object.entries(b)) fd.set(k, typeof v === 'string' ? v : JSON.stringify(v))
      for (const f of Array.from(new Set([...FILE_FIELDS, ...shape.form.filter((k) => /file|photo|image|logo|attach|doc|upload/i.test(k))]))) {
        fd.set(f, new Blob([PNG], { type: 'image/png' }), 'x.png')
      }
      payload = fd
    }
  }
  mockReq = { headers, cookies: [{ name: 'sb-proj-auth-token', value: cookieValue }] }
  const abort = new AbortController()
  const req = new NextRequest(url, { method, headers, body: payload, signal: abort.signal })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 4000) })
  try {
    const res = await Promise.race([handler(req, { params }), timeout])
    if (res === 'timeout') return { status: 'timeout' as const, text: '' }
    const loc = res.headers?.get?.('location') ?? ''
    return { status: res.status, text: `${await readBody(res)} ${loc}` }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e)
    return { status: 'threw' as const, text: msg, error: msg.slice(0, 160) }
  } finally {
    clearTimeout(timer)
    abort.abort() // ends server-sent-event streams (their abort listener clears the poll timers)
  }
}

/** Whole body, or what a stream (server-sent events) sent in its first 1.5 s — the first push is where a leak would be. */
async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const dec = new TextDecoder()
  let out = ''
  const deadline = Date.now() + 1500
  try {
    for (;;) {
      const left = deadline - Date.now()
      if (left <= 0) break
      let t: NodeJS.Timeout | undefined
      const chunk = await Promise.race([reader.read(), new Promise<'late'>((r) => { t = setTimeout(() => r('late'), left) })])
      clearTimeout(t)
      if (chunk === 'late' || chunk.done) break
      out += dec.decode(chunk.value, { stream: true })
    }
  } catch { /* stream errored */ }
  await reader.cancel().catch(() => undefined)
  return out
}

/**
 * SQL functions that are called with an id from the request, each read and confirmed to check the id against the
 * caller's own org (passed as p_org_id from the signed-in profile). Any OTHER rpc that receives company A's id fails the
 * suite until someone reads its SQL and adds it here.
 */
const VERIFIED_RPCS: Record<string, string> = {
  unapprove_billed_time: 'supabase/migrations/202611120030_hourly_billing.sql: UPDATE billed_time_days WHERE id = p_id AND org_id = p_org (route passes the caller org); tested in supabase/tests/hourly_billing.test.sql T5',
  approve_billed_time: 'supabase/migrations/202611120030_hourly_billing.sql: job `id = p_job AND org_id = p_org` / visit `id = p_visit AND org_id = p_org` else P0002; tested T4/T8',
  cancel_management_comp_overlay: 'supabase/migrations/202608070001_management_comp_overlays.sql: assignment WHERE id = p_assignment_id AND org_id = p_org_id (route passes auth.profile.org_id)',
  end_management_comp_overlay: 'supabase/migrations/202608070001_management_comp_overlays.sql: assignment WHERE id = p_assignment_id AND org_id = p_org_id',
  assign_primary_comp_plan: 'supabase/migrations/202608070001_management_comp_overlays.sql: target user AND plan both `org_id = p_org_id` (admin/data passes profile.org_id)',
  save_supplier: 'supabase/migrations/202610220030_supplier_atomic_save.sql: vendors WHERE id = p_id AND org_id = p_org, else supplier_not_found (route passes profile.org_id)',
  cancel_production_job: 'supabase/migrations/202609140001_production_job_cancellation.sql: WHERE id = p_job_id AND org_id = p_org_id, else P0002',
  uncancel_production_job: 'supabase/migrations/202609260001_uncancel_restore_only_this_cancel.sql: WHERE id = p_job_id AND org_id = p_org_id, else P0002',
  record_job_payment: 'supabase/migrations/202611120020_online_payments.sql: production_jobs WHERE id = p_job AND org_id = p_org, else P0002 (route passes profile.org_id)',
  apply_job_invoice_payment: 'supabase/migrations/202611120020_online_payments.sql: invoice JOIN production_jobs WHERE pj.org_id = p_org, else P0002; payment must be that invoice job\'s',
  record_customer_invoice_payment: 'supabase/migrations/202611120020_online_payments.sql: job_invoices WHERE id = p_invoice AND org_id = p_org (job_id NULL), else P0002',
  payment_link_take_attempt: 'supabase/migrations/202611120020_online_payments.sql: only counts attempts on the link row the hashed token resolved (no company data read or written)',
}

/**
 * Company-B rows that may legitimately carry an id that happens to be company A's. Empty: a B row pointing at an A
 * record is a cross-company reference (it can squat A's unique keys or show up in A's lists), so it fails the suite.
 */
const ALLOWED_XREF: Record<string, string> = {
  'leads.external_lead_id': 'webhooks/leads: the sending system\'s own lead id (free text from the webhook body), not a CRM row reference',
  'campaigns.google_campaign_id': 'ad-platform campaign id (free text), not a CRM row',
  'campaigns.google_ads_campaign_id': 'ad-platform campaign id (free text), not a CRM row',
  'campaigns.facebook_campaign_id': 'ad-platform campaign id (free text), not a CRM row',
  'campaigns.external_id': 'ad-platform id (free text), not a CRM row',
}

/** The harness must catch a hole when there is one; otherwise every green route below proves nothing. */
describe('harness catches a planted hole', () => {
  const { createServiceClient } = jest.requireActual('@/lib/supabase/service') as typeof import('@/lib/supabase/service')
  const run = async (h: (req: NextRequest, ctx: { params: Record<string, unknown> }) => Promise<Response>) => {
    mockWorld = createWorld(TABLES, ORG_TABLES)
    const r = await attack(h, 'POST', '/api/planted/[id]', 'json')
    return { kinds: findings(mockWorld, r.text).map((f) => f.kind), xref: crossReferences(mockWorld, ROOT) }
  }
  test('read by id with no org filter → leak', async () => {
    const out = await run(async (_req, { params }) => {
      const { data } = await createServiceClient().from('leads').select('*').eq('id', params.id as string).maybeSingle()
      return Response.json(data)
    })
    expect(out.kinds).toContain('leak')
  })
  test('update by id with no org filter → write', async () => {
    const out = await run(async (_req, { params }) => {
      await createServiceClient().from('production_jobs').update({ status: 'cancelled' }).eq('id', params.id as string)
      return Response.json({ ok: true })
    })
    expect(out.kinds).toContain('write')
  })
  test('child row on A parent → insert_into_a; B row pointing at A → cross-reference', async () => {
    const out = await run(async (_req, { params }) => {
      const db = createServiceClient()
      await db.from('job_payments').insert({ job_id: params.id, amount: 1 })
      await db.from('inspection_results').insert({ org_id: ORG_B, opportunity_id: params.id })
      return Response.json({ ok: true })
    })
    expect(out.kinds).toContain('insert_into_a')
    expect(out.xref).toContain('inspection_results.opportunity_id')
  })
  test('an RLS (user-token) read of A rows sees nothing', async () => {
    const { createClient } = jest.requireMock('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => ReturnType<typeof createServiceClient> }
    mockWorld = createWorld(TABLES, ORG_TABLES)
    const c = createClient('u', 'anon-key-test', { global: { headers: { Authorization: `Bearer ${ATTACKER_TOKEN}` } } })
    const { data } = await c.from('leads').select('*')
    expect((data as Array<{ org_id: string }>).map((r) => r.org_id)).toEqual([ORG_B])
  })
})

/** Upload routes get real multipart first; anything else JSON, falling back to multipart if JSON is refused. */
const PAY_WEEK_ROUTE = /^\/api\/(admin\/payroll\/pay-week|my-pay)(\/|$)/

async function send(h: never, method: string, routePath: string, shape: RequestShape) {
  // The new payroll screens sit behind PAYROLL_PAY_WEEK_ENABLED (lib/payroll-flag.ts, default off): on for their own
  // routes only, so they are attacked past the flag while every other route keeps the shipped (flag off) behaviour.
  if (PAY_WEEK_ROUTE.test(routePath)) process.env.PAYROLL_PAY_WEEK_ENABLED = 'true'
  else delete process.env.PAYROLL_PAY_WEEK_ENABLED
  mockWorld = createWorld(TABLES, ORG_TABLES, 'admin', routePath, variant?.seed)
  let r = await attack(h, method, routePath, shape.multipart ? 'form' : 'json', shape)
  if (!shape.multipart && r.status === 'threw' && /Content-Type was not one of/.test(r.text)) {
    mockWorld = createWorld(TABLES, ORG_TABLES, 'admin', routePath, variant?.seed)
    r = await attack(h, method, routePath, 'form', shape)
  }
  return r
}

/**
 * Reads of company A rows that are allowed: the route loads a row by the request id and then refuses it because its
 * org_id is not the caller's (the "load by id, then check" pattern the org-scope gate accepts). Each was read; the
 * refusal returns before anything of the row is used. Anything else that reads an A row fails.
 */
const READ_THEN_CHECK: Record<string, string> = {
  'PUT /api/admin/presets': 'admin/presets: load by id, `existing.org_id !== profile.org_id` → 404',
  'DELETE /api/admin/presets': 'admin/presets: load by id, `existing.org_id !== profile.org_id` → 404',
  'PUT /api/admin/users': 'admin/users: target loaded by id, `targetUser.org_id !== profile.org_id` → 404',
  'DELETE /api/admin/users': 'admin/users: target loaded by id, `targetUser.org_id !== profile.org_id` → 404',
  'PUT /api/admin/user-permissions': 'admin/user-permissions: target loaded by id, org mismatch → 404',
  'GET /api/measurements/[id]': 'measurements/[id]: row loaded by id, `row.org_id !== profile.org_id` → 403',
  'DELETE /api/measurements/[id]': 'measurements/[id]: row loaded by id, org mismatch → 403',
  'GET /api/canvass/team-availability': 'canvass/team-availability: team loaded by id, `team.org_id !== profile.org_id` → 404',
  'GET /api/sisu/badges': 'sisu/badges: target user loaded by id, org mismatch → 404',
  'POST /api/jobs/[id]/review-request': 'jobs/[id]/review-request: job loaded by id, `job.org_id !== profile.org_id` → 404',
  'POST /api/projects/[id]/review': 'projects/[id]/review: project loaded by id, org mismatch → 404',
  'GET /api/org-logo/[orgId]': 'org-logo: a company logo is public by design (login pages, documents); only the logo path is signed',
  'POST /api/portal/request-link': 'portal: public sign-in on company A\'s own address; reads A\'s org row for the switch only, and mails nothing unless the address typed matches an A customer',
  'POST /api/portal/enter': 'portal: public sign-in on company A\'s own address; reads A\'s org row for the switch and logs the attempt against A. Nothing of A is returned without a valid A link',
  'GET /api/company-logo': 'company-logo: serves the logo of the company whose web address this is (A on A\'s address) — public by design',
}

/** Successful (2xx) responses may echo company A's id only where listed (the route repeats the request back). */
const ECHO_OK: Record<string, string> = {
  'POST /api/campaigns': 'echoes the ad-platform campaign ids it was sent (free text, see ALLOWED_XREF); no A row is read',
  'POST /api/ops/billing': 'echoes request keys it could not bill under `alreadyBilled`; units come only from the caller\'s own ready-to-bill load (no A row is read)',
}

const reachedByControl = new Set<string>()
let controlRuns = 0

for (const m of MODES) {
  describe(`company B (${m.name}) cannot read or change company A through any API route`, () => {
    beforeAll(() => {
      mode = m
      if (m.baseDomain) process.env.APP_BASE_DOMAIN = m.baseDomain
      else delete process.env.APP_BASE_DOMAIN
      __resetCompanyHostCacheForTests()
    })
    for (const file of routeFiles) {
      const routePath = routePathOf(ROOT, file)
      if (NOT_EXERCISED[routePath]) continue
      test(routePath, async () => {
        const problems: string[] = []
        let mod: Record<string, unknown>
        try {
          mod = require(file)
        } catch (e) {
          const msg = String((e as Error).message).slice(0, 160)
          outcomes.push({ mode: m.name, route: routePath, method: 'IMPORT', status: 'threw', error: msg, findings: [], xref: [], readA: false, rpcA: [], reached: false })
          throw new Error(`IMPORT ${routePath}: ${msg}`)
        }
        const shape = requestShape(file)
        for (const method of METHODS) {
          const h = mod[method]
          if (typeof h !== 'function') continue
          const key = `${method} ${routePath}`
          const variants: Array<Variant | null> = FIXTURES[key] ?? FIXTURES[routePath] ?? [null]
          for (let vi = 0; vi < variants.length; vi++) {
            const v = variants[vi]
            variant = v
            const tag = variants.length > 1 ? `${key} #${vi + 1}` : key
            // Control (own mode only): the same request with company B's own ids.
            let control: { status: number | 'threw' | 'timeout'; text: string } | undefined
            if (m.name === 'own') {
              target = refTarget = BRAVO_ROW_ID
              targetOrg = ORG_B
              try {
                control = await send(h as never, method, routePath, shape)
                controlRuns++
                if (reachedB(mockWorld) || control.text.includes('Bravo')) reachedByControl.add(key)
                // "Own record, A's references": B's own ids in the path and `id`, A's ids in every other reference field
                // and A's org_id — catches re-homing a B row into A and B rows left pointing at A's records.
                if (method !== 'GET') {
                  refTarget = VICTIM_ID
                  targetOrg = ORG_A
                  const mixed = await send(h as never, method, routePath, shape)
                  for (const x of findings(mockWorld, mixed.text)) problems.push(`${tag} [own record, A refs: ${mixed.status}] ${x.kind}: ${x.detail}`)
                  for (const x of crossReferences(mockWorld, ROOT)) if (!ALLOWED_XREF[x]) problems.push(`${tag} [own record, A refs: ${mixed.status}] cross-reference: company B row ${x} = company A's id`)
                }
              } finally {
                target = refTarget = VICTIM_ID
                targetOrg = ORG_A
              }
            }
            const r = await send(h as never, method, routePath, shape)
            const f = findings(mockWorld, r.text)
            const rpcA = mockWorld.rpcs.filter((x) => JSON.stringify(x.args).match(new RegExp(`${VICTIM_ID}|${ORG_A}`))).map((x) => x.name)
            const xref = crossReferences(mockWorld, ROOT)
            const readA = Array.from(new Set(mockWorld.readsOfA))
            outcomes.push({
              mode: m.name, route: routePath, method, status: r.status, error: 'error' in r ? r.error : undefined, findings: f, xref,
              readA: readA.length > 0, rpcA, reached: reachedByControl.has(key), controlStatus: control?.status, controlText: control?.text.slice(0, 200),
            })
            for (const x of f) problems.push(`${tag} [${r.status}] ${x.kind}: ${x.detail}`)
            for (const x of xref) if (!ALLOWED_XREF[x]) problems.push(`${tag} [${r.status}] cross-reference: company B row ${x} = company A's id`)
            for (const n of rpcA) if (!VERIFIED_RPCS[n]) problems.push(`${tag} [${r.status}] rpc ${n} received company A's id — read its SQL, then list it in VERIFIED_RPCS`)
            if (readA.length && !READ_THEN_CHECK[key]) problems.push(`${tag} [${r.status}] read company A rows from ${readA.join(', ')}`)
            if (typeof r.status === 'number' && r.status < 300 && r.text.includes(VICTIM_ID) && !ECHO_OK[key]) {
              problems.push(`${tag} [${r.status}] successful response carries company A's record id`)
            }

          }
          variant = null
        }
        expect(problems).toEqual([])
      }, 60_000)
    }
  })
}

/**
 * Middleware (the company web-address fence) run for real, then its forwarded request headers handed to a route —
 * the production order. B's session on A's address, B's session with a forged "already resolved" header, and an
 * address that is no company.
 */
describe('middleware + route: company web address', () => {
  const { middleware } = require(join(ROOT, 'middleware.ts')) as { middleware: (r: NextRequest) => Promise<Response> }
  const route = require(join(ROOT, 'app/api/customers/[id]/route.ts')) as { GET: (r: NextRequest, c: unknown) => Promise<Response> }
  const cookieValue = encodeURIComponent(JSON.stringify({ access_token: ATTACKER_TOKEN }))
  beforeAll(() => {
    mode = { name: 'middleware', host: 'alpha.crm.test', baseDomain: 'crm.test' }
    process.env.APP_BASE_DOMAIN = 'crm.test'
    __resetCompanyHostCacheForTests()
  })
  afterAll(() => {
    delete process.env.APP_BASE_DOMAIN
    __resetCompanyHostCacheForTests()
  })

  /** Middleware, then (if it passes) the route with the headers middleware forwarded. */
  async function through(host: string, id: string, extra: Record<string, string> = {}) {
    mockWorld = createWorld(TABLES, ORG_TABLES)
    const url = `https://${host}/api/customers/${id}`
    const headers = new Headers({ host, authorization: `Bearer ${ATTACKER_TOKEN}`, cookie: `sb-proj-auth-token=${cookieValue}`, ...extra })
    const mw = await middleware(new NextRequest(url, { headers }))
    if (!mw.headers.get('x-middleware-next')) return { status: mw.status, text: await mw.text(), forwarded: null as Headers | null }
    const forwarded = new Headers(headers)
    for (const name of (mw.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) {
      const v = mw.headers.get(`x-middleware-request-${name}`)
      if (v === null) forwarded.delete(name)
      else forwarded.set(name, v)
    }
    mockReq = { headers: forwarded, cookies: [{ name: 'sb-proj-auth-token', value: cookieValue }] }
    const res = await route.GET(new NextRequest(url, { headers: forwarded }), { params: { id } })
    return { status: res.status, text: await res.text(), forwarded }
  }

  test('control: B on its own address reaches its own customer', async () => {
    const r = await through('bravo.crm.test', BRAVO_ROW_ID)
    expect(r.status).toBe(200)
    expect(r.text).toContain('Bravo')
  })
  test('B signed in, on A\'s address: refused, nothing of A', async () => {
    const r = await through('alpha.crm.test', VICTIM_ID)
    expect(r.status).toBe(401)
    expect(findings(mockWorld, r.text)).toEqual([])
    // Even B's own record is refused on A's address.
    expect((await through('alpha.crm.test', BRAVO_ROW_ID)).status).toBe(401)
  })
  test('a client-sent "already resolved" header is replaced by middleware', async () => {
    const r = await through('alpha.crm.test', VICTIM_ID, { 'x-company-resolved': 'forged.by.client' })
    expect(r.forwarded?.get('x-company-resolved')).not.toBe('forged.by.client')
    expect(r.status).toBe(401)
  })
  test('an address that is no company: 404 before any route code', async () => {
    const r = await through('nobody.crm.test', VICTIM_ID)
    expect(r.status).toBe(404)
    expect(mockWorld.readsOfA).toEqual([])
  })
  test('B with the iPhone company code of A: refused', async () => {
    const r = await through('legacy.example', VICTIM_ID, { 'x-company-code': 'alpha' })
    expect(r.status).toBe(401)
    expect(findings(mockWorld, r.text)).toEqual([])
  })
})


/**
 * The customer portal: a signed-in PORTAL customer (not staff) of company B — the other side of the door. Customers are
 * not users, so the staff sweep above only proves staff routes refuse a portal-less caller; here a real portal session
 * of B's customer B1 calls every portal route with company A's ids (A's invoices, documents, photos, A's customer in the
 * body) and with another customer's of the SAME company, and A's address / A's links are tried with B's session.
 */
describe('customer portal: B1 cannot see A1 (same company or another)', () => {
  const { hashPortalToken, customerEmailKey } = require(join(ROOT, 'lib/portal/tokens.ts')) as typeof import('@/lib/portal/tokens')
  const TOKEN = 'p'.repeat(43)
  const B2 = '0b0b0b0b-0000-4000-8000-0000000000b2' // a second customer of company B
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const world = () => {
    mockWorld = createWorld(TABLES, ORG_TABLES, 'admin', undefined, (seed) => {
      seed.portal_sessions = [{ id: 'sess-b1', org_id: ORG_B, customer_id: BRAVO_ROW_ID, token_hash: hashPortalToken(TOKEN), email_key: customerEmailKey(ORG_B, String(((seed.customers ?? []).find((c) => c.id === BRAVO_ROW_ID) as { email?: unknown } | undefined)?.email ?? '')), expires_at: future, revoked_at: null, last_seen_at: new Date().toISOString() }]
      // Company B runs the roofing default (invite only): its customer B1 is invited, B2 is not.
      seed.customers = (seed.customers ?? []).map((c) => (c.id === BRAVO_ROW_ID ? { ...c, portal_invited_at: new Date().toISOString() } : c))
      seed.customers = [...(seed.customers ?? []), { id: B2, org_id: ORG_B, name: 'Bravo Two', email: 'two@bravo.test', phone: null }]
      seed.job_invoices = [...(seed.job_invoices ?? []), { id: 'b2b2b2b2-0000-4000-8000-0000000000e2', org_id: ORG_B, customer_id: B2, job_id: null, invoice_number: 'INV-B2', status: 'sent', total_cents: 700, created_at: new Date().toISOString() }]
      seed.documents = [...(seed.documents ?? []), { id: 'b2b2b2b2-0000-4000-8000-0000000000d2', org_id: ORG_B, customer_id: B2, job_id: null, title: 'Bravo Two private', filename: 'two.pdf', storage_path: 'org/b/two.pdf', shared_with_customer: true, status: 'active', deleted_at: null, created_at: new Date().toISOString() }]
    })
  }
  const as = (host: string, cookie: string | null, extra: Record<string, string> = {}) => {
    mockReq = { headers: new Headers({ host, ...extra }), cookies: cookie ? [{ name: 'portal_session', value: cookie }] : [] }
  }
  const call = async (file: string, method: 'GET' | 'POST', host: string, url: string, params: Record<string, string>, body?: unknown) => {
    const mod = require(join(ROOT, file)) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>
    const headers = new Headers({ host, 'content-type': 'application/json' })
    const res = await mod[method](new NextRequest(`https://${host}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { params })
    return { status: res.status, text: `${await res.text()} ${res.headers.get('location') ?? ''}` }
  }
  const FILES = 'app/api/portal/files/[kind]/[id]/route.ts'
  const PAY = 'app/api/portal/invoices/[id]/pay/route.ts'
  const MSG = 'app/api/portal/messages/route.ts'
  const CARD = 'app/api/portal/card/route.ts'
  const ENTER = 'app/api/portal/enter/route.ts'
  beforeAll(() => {
    process.env.APP_BASE_DOMAIN = 'crm.test'
    __resetCompanyHostCacheForTests()
  })
  afterAll(() => {
    delete process.env.APP_BASE_DOMAIN
    __resetCompanyHostCacheForTests()
  })

  test('control: B1 on B’s address is a real session and reads only B1', async () => {
    world()
    as('bravo.crm.test', TOKEN)
    const { getPortalSession } = require(join(ROOT, 'lib/portal/server.ts')) as typeof import('@/lib/portal/server')
    const { loadPortalHome } = require(join(ROOT, 'lib/portal/data.ts')) as typeof import('@/lib/portal/data')
    const s = await getPortalSession(mockWorld.db.client as never)
    expect(s).toMatchObject({ orgId: ORG_B, customerId: BRAVO_ROW_ID })
    const home = await loadPortalHome(mockWorld.db.client as never, s!)
    expect(home).not.toBeNull()
    expect(JSON.stringify(home)).not.toMatch(/Bravo Two|INV-B2|two\.pdf/)
    expect(findings(mockWorld, JSON.stringify(home))).toEqual([])
    expect(mockWorld.readsOfA).toEqual([])
  })

  test('B1 with A’s (and B2’s) invoice / document / photo ids: 404, nothing of A or B2 in any answer, nothing written to A', async () => {
    world()
    as('bravo.crm.test', TOKEN)
    const ids = [VICTIM_ID, 'b2b2b2b2-0000-4000-8000-0000000000e2', 'b2b2b2b2-0000-4000-8000-0000000000d2']
    const texts: string[] = []
    for (const id of ids) {
      for (const kind of ['document', 'photo']) {
        const r = await call(FILES, 'GET', 'bravo.crm.test', `/api/portal/files/${kind}/${id}`, { kind, id })
        expect([r.status, kind, id]).toEqual([404, kind, id])
        texts.push(r.text)
      }
      const p = await call(PAY, 'POST', 'bravo.crm.test', `/api/portal/invoices/${id}/pay`, { id }, {})
      expect([p.status, id]).toEqual([404, id])
      texts.push(p.text)
    }
    expect(findings(mockWorld, texts.join(' '))).toEqual([])
    expect(texts.join(' ')).not.toMatch(/INV-B2|two\.pdf|Bravo Two/)
    expect(mockWorld.storage.filter((x) => x.op === 'createSignedUrl')).toEqual([])
    expect(mockWorld.readsOfA).toEqual([])
  })

  test('a message that names A’s customer / org is stored for B1 only; card + pay routes never touch A', async () => {
    world()
    as('bravo.crm.test', TOKEN)
    const m = await call(MSG, 'POST', 'bravo.crm.test', '/api/portal/messages', {}, { body: 'hello', customer_id: VICTIM_ID, org_id: ORG_A, customerId: VICTIM_ID })
    expect(m.status).toBe(200)
    const rows = mockWorld.db.tables.activities.filter((r) => r.body === 'hello')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ org_id: ORG_B, customer_id: BRAVO_ROW_ID, origin: 'customer_portal', audience: 'team' })
    for (const action of ['autopay_off', 'remove', 'save']) await call(CARD, 'POST', 'bravo.crm.test', '/api/portal/card', {}, { action, customer_id: VICTIM_ID, org_id: ORG_A })
    expect(findings(mockWorld, m.text)).toEqual([])
    expect(mockWorld.readsOfA).toEqual([])
  })

  test('B1’s session cookie on A’s address: every portal route answers 401/404, no portal page data', async () => {
    world()
    as('alpha.crm.test', TOKEN)
    const { getPortalSession } = require(join(ROOT, 'lib/portal/server.ts')) as typeof import('@/lib/portal/server')
    expect(await getPortalSession(mockWorld.db.client as never)).toBeNull()
    for (const [file, method, url, params, body] of [
      [FILES, 'GET', '/api/portal/files/document/x', { kind: 'document', id: 'x' }, undefined],
      [PAY, 'POST', '/api/portal/invoices/x/pay', { id: 'x' }, {}],
      [MSG, 'POST', '/api/portal/messages', {}, { body: 'hi' }],
      [CARD, 'POST', '/api/portal/card', {}, { action: 'remove' }],
    ] as const) {
      const r = await call(file, method, 'alpha.crm.test', url, params as Record<string, string>, body)
      expect([file, r.status]).toEqual([file, 401])
    }
    expect(mockWorld.db.tables.activities.filter((r) => r.body === 'hi')).toEqual([])
    expect(findings(mockWorld, '')).toEqual([])
  })

  test('company A\'s sign-in link opened on B\'s address starts no session and is not burned (on A\'s own address it works — the control)', async () => {
    world()
    const link = 'r'.repeat(43)
    const t = mockWorld.db.tables as Record<string, Array<Record<string, unknown>>>
    ;(t.portal_login_tokens ??= []).push({ id: 'lt-a', org_id: ORG_A, customer_id: VICTIM_ID, token_hash: hashPortalToken(link), sent_to: String(((t.customers ?? []).find((c) => c.id === VICTIM_ID) as { email?: unknown } | undefined)?.email ?? ''), expires_at: new Date(Date.now() + 600_000).toISOString(), used_at: null })
    as('bravo.crm.test', null)
    const fd = () => { const f = new FormData(); f.set('t', link); return f }
    const mod = require(join(ROOT, ENTER)) as { POST: (r: NextRequest) => Promise<Response> }
    const bad = await mod.POST(new NextRequest('https://bravo.crm.test/api/portal/enter', { method: 'POST', body: fd(), headers: new Headers({ host: 'bravo.crm.test' }) }))
    expect(bad.headers.get('set-cookie')).toBeNull()
    expect(mockWorld.db.tables.portal_sessions.filter((r) => r.customer_id === VICTIM_ID)).toEqual([])
    expect(t.portal_login_tokens.find((r) => r.id === 'lt-a')?.used_at).toBeNull()
    as('alpha.crm.test', null)
    const ok = await mod.POST(new NextRequest('https://alpha.crm.test/api/portal/enter', { method: 'POST', body: fd(), headers: new Headers({ host: 'alpha.crm.test' }) }))
    expect(ok.headers.get('set-cookie')).toMatch(/portal_session=/)
    expect(mockWorld.db.tables.portal_sessions.filter((r) => r.customer_id === VICTIM_ID && r.org_id === ORG_A)).toHaveLength(1)
  })
})

/**
 * Ratchet: how many handlers the control reaches a record with. A route that stops reaching (a fixture broke, a guess no
 * longer fits) makes its attack result vacuous, so the count may only rise. Raise the baseline when you add fixtures.
 */
describe('control reach ratchet', () => {
  test('handlers that reach a record with company B\'s own ids', () => {
    const handlers = routeFiles.reduce((n, f) => {
      const mod = require(f) as Record<string, unknown>
      return n + METHODS.filter((x) => typeof mod[x] === 'function').length
    }, 0)
    if (controlRuns < handlers) return // a -t filter skipped some routes; the full run checks the count
    const baseline = JSON.parse(fs.readFileSync(join(ROOT, 'scripts', 'breakin-reach-baseline.json'), 'utf8')) as { reached: number }
    if (process.env.BREAKIN_REACH_UPDATE && reachedByControl.size > baseline.reached) {
      fs.writeFileSync(join(ROOT, 'scripts', 'breakin-reach-baseline.json'), JSON.stringify({ reached: reachedByControl.size }, null, 2) + '\n')
    }
    expect(reachedByControl.size).toBeGreaterThanOrEqual(baseline.reached)
  })
})

/**
 * Background jobs run for every company at once (lib/cron-orgs.ts). Called the way Vercel calls them (the real cron
 * secret, no user), with both companies holding data: nothing written for one company may point at the other's
 * records, and no email to one company's people may carry the other's data.
 */
describe('crons keep each company to itself', () => {
  beforeAll(() => {
    mode = { name: 'cron', host: 'legacy.example' }
    delete process.env.APP_BASE_DOMAIN
    __resetCompanyHostCacheForTests()
  })
  const cronFiles = routeFiles.filter((f) => routePathOf(ROOT, f).startsWith('/api/cron/'))
  test('there are crons to check', () => expect(cronFiles.length).toBeGreaterThan(5))
  for (const file of cronFiles) {
    const routePath = routePathOf(ROOT, file)
    test(routePath, async () => {
      const mod = require(file) as Record<string, unknown>
      const problems: string[] = []
      for (const method of METHODS) {
        const h = mod[method]
        if (typeof h !== 'function') continue
        mockWorld = createWorld(TABLES, ORG_TABLES)
        const headers = new Headers({ authorization: `Bearer ${process.env.CRON_SECRET}`, host: mode.host })
        if (method !== 'GET') headers.set('content-type', 'application/json')
        mockReq = { headers, cookies: [] }
        const req = new NextRequest(`https://${mode.host}${routePath}`, { method, headers, body: method === 'GET' ? undefined : '{}' })
        let status: number | string = 'threw'
        let timer: NodeJS.Timeout | undefined
        try {
          const late = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), 8000) })
          const res = await Promise.race([(h as (r: NextRequest, c: unknown) => Promise<Response>)(req, { params: {} }), late])
          status = res === 'timeout' ? 'timeout' : res.status
        } catch (e) {
          status = `threw ${String((e as Error).message).slice(0, 80)}`
        } finally {
          clearTimeout(timer)
        }
        outcomes.push({ mode: 'cron', route: routePath, method, status: typeof status === 'number' ? status : 'threw', error: typeof status === 'string' ? status : undefined, findings: [], xref: crossings(mockWorld), readA: mockWorld.readsOfA.length > 0, rpcA: [], reached: mockWorld.readsOfBRecord.length > 0 })
        for (const x of crossings(mockWorld)) problems.push(`${method} ${routePath} [${status}] ${x}`)
      }
      expect(problems).toEqual([])
    }, 60_000)
  }
})

/**
 * Server pages with an id in the address (any `[param]` folder under app, e.g. app/leads/[id]/page.tsx). The page function runs as company B's owner with
 * A's ids; the element tree it returns is rendered shallowly (async server children are awaited, client components
 * are not run) and every prop is searched for A's data — a server page hands its data to client components as props.
 * redirect / notFound count as refusals. 'use client' pages load their data from /api (covered above).
 */
const pageFiles = walk(join(ROOT, 'app'))
  .filter((f) => f.endsWith(`${sep}page.tsx`) && f.includes('[') && !f.includes(`${sep}api${sep}`) && !f.includes('dev-harness'))
  .sort()

async function renderShallow(node: unknown, depth = 0): Promise<unknown> {
  if (depth > 12 || node == null || typeof node !== 'object') return node
  if (Array.isArray(node)) return Promise.all(node.map((n) => renderShallow(n, depth + 1)))
  const el = node as { type?: unknown; props?: Record<string, unknown> }
  if (!('$$typeof' in (node as object))) return node
  const props = el.props ?? {}
  // An async function component is a server component: run it (that is where its data comes from).
  if (typeof el.type === 'function' && el.type.constructor?.name === 'AsyncFunction') {
    return renderShallow(await (el.type as (p: unknown) => Promise<unknown>)(props), depth + 1)
  }
  return { type: typeof el.type === 'string' ? el.type : (el.type as { name?: string })?.name ?? 'C', props: await renderShallow(Object.fromEntries(Object.entries(props)), depth + 1) }
}

function safeJson(v: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'object' && x !== null) {
      if (seen.has(x)) return '[circular]'
      seen.add(x)
    }
    return typeof x === 'function' ? undefined : x
  }) ?? ''
}

for (const m of MODES) {
  describe(`company B (${m.name}) cannot open company A's records through a server page`, () => {
    beforeAll(() => {
      mode = m
      if (m.baseDomain) process.env.APP_BASE_DOMAIN = m.baseDomain
      else delete process.env.APP_BASE_DOMAIN
      __resetCompanyHostCacheForTests()
    })
    for (const file of pageFiles) {
      const rel = file.slice(ROOT.length)
      const client = /^\s*['"]use client['"]/.test(fs.readFileSync(file, 'utf8'))
      ;(client ? test.skip : test)(rel, async () => {
        const routePath = routePathOf(ROOT, file).replace(/\/page\.tsx$/, '')
        const page = (require(file) as { default: (p: unknown) => unknown }).default
        mockWorld = createWorld(TABLES, ORG_TABLES)
        const { params } = urlFor(routePath)
        const searchParams = Object.fromEntries(new URL(urlFor(routePath).url).searchParams)
        const cookieValue = encodeURIComponent(JSON.stringify({ access_token: ATTACKER_TOKEN }))
        const headers = new Headers({ authorization: `Bearer ${ATTACKER_TOKEN}`, host: mode.host, cookie: `sb-proj-auth-token=${cookieValue}` })
        if (mode.code) headers.set('x-company-code', mode.code)
        mockReq = { headers, cookies: [{ name: 'sb-proj-auth-token', value: cookieValue }] }
        let text = ''
        let status = 'rendered'
        try {
          text = safeJson(await renderShallow(await page({ params, searchParams })))
        } catch (e) {
          const d = String((e as { digest?: string }).digest ?? (e as Error).message)
          status = /NEXT_REDIRECT|NEXT_NOT_FOUND/.test(d) ? d.split(';')[0] : `threw ${d.slice(0, 120)}`
        }
        const f = findings(mockWorld, text)
        const xref = crossReferences(mockWorld, ROOT)
        outcomes.push({ mode: m.name, route: rel, method: 'PAGE', status: status === 'rendered' ? 200 : 'threw', error: status, findings: f, xref, readA: mockWorld.readsOfA.length > 0, rpcA: [], reached: mockWorld.readsOfBRecord.length > 0 || text.includes('Bravo') })
        expect([...f.map((x) => `${x.kind}: ${x.detail}`), ...xref.map((x) => `cross-reference ${x}`)]).toEqual([])
      }, 60_000)
    }
  })
}

afterAll(() => {
  if (!process.env.BREAKIN_REPORT) return
  // Coverage table for humans: BREAKIN_REPORT=1 npx jest cross-company-breakin
  const fs = jest.requireActual('node:fs') as typeof import('node:fs')
  fs.writeFileSync(process.env.BREAKIN_REPORT, JSON.stringify(outcomes, null, 1))
})
