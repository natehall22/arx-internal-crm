/**
 * Cross-company break-in harness (S4). Company A (victim) and company B (attacker) share one fake database; every
 * company-A row in every table has the SAME id (`VICTIM_ID`), so any `[param]`, query or body id an attacker sends
 * lands on an A row in whichever table the route reads. A rows carry marker values (`ALPHA_SECRET`, an `alpha.test`
 * email, a 987654.32 amount, a 704-555-0199 phone) so a leak is visible in any response body, email, outbound call
 * or storage path.
 *
 * Clients: the service-role key sees everything (no RLS — the case a missing org filter turns into a leak). A
 * user-token client is EMULATED as company-scoped RLS (it sees only rows of the token's company). That emulation is an
 * assumption about the SQL policies, not proof of them; RLS policies are audited separately.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { createFakeDb } from '@/lib/test-helpers/fake-db'
import { ORG_FEATURE_KEYS, featureDefaultOn } from '@/lib/org-features'

type Row = Record<string, unknown>

export const VICTIM_ID = '0a0a0a0a-0000-4000-8000-00000000000a'
export const ORG_A = 'aaaaaaaa-0000-4000-8000-0000000000aa'
export const ORG_B = 'bbbbbbbb-0000-4000-8000-0000000000bb'
export const ATTACKER_ID = 'bbbbbbbb-0000-4000-8000-0000000000b1'
export const ATTACKER_TOKEN = 'tok-b'
/** Company B's own record id (every B row shares it) — used by the self-check run to prove a route reaches data. */
export const BRAVO_ROW_ID = '0b0b0b0b-0000-4000-8000-00000000000b'
/**
 * Company B's own VALID public token (crew link, signing link, report link, webhook key): 64 hex chars, so it passes every
 * token-format check. The attack sends it with company A's ids, i.e. "B holds a real link — can it be walked to A's records?"
 */
export const BRAVO_PUBLIC_TOKEN = 'b0'.repeat(32)
export const SERVICE_KEY = 'service-key-test'
export const MARK = 'ALPHA_SECRET'
export const A_EMAIL = 'alpha_secret@alpha.test'
export const A_PHONE = '7045550199'
export const A_AMOUNT = 987654.32
export const A_TOKEN = 'alpha-public-token-0000'
/** Any of these in a response / email / outbound call means company A's data reached company B. (A's org id and
 * public token are not in the list for responses: the attacker sends both, and routes may echo the request.) */
/** Company A rows' created_at/updated_at — a field of A's that is not a marker string (B rows use 2026-11-02). */
export const A_STAMP = '2026-11-01T12:00:00.000Z'
export const LEAK_PATTERNS = [MARK, 'alpha.test', '987654', A_PHONE, '2026-11-01T12']
/** Storage paths and auth-admin calls also fail on A's org id / token (the attacker cannot get those signed). */
const PATH_PATTERNS = [...LEAK_PATTERNS, ORG_A, A_TOKEN]
/** Hidden owner tag on child rows (tables with no org_id): lets the RLS emulation hide them from other companies. */
export const OWNER_TAG = '__owner_org'
/** Shared reference data — every company reads the same rows by design, so no company-A row is seeded. */
export const GLOBAL_TABLES = new Set([
  'permissions', 'preset_permissions', 'canvass_parcel_years', 'instant_estimate_calibration', 'lidar_tiles', 'solar_candidates',
  'solar_installs', 'weather_refresh_runs', 'nope',
])

/** Company tables (have org_id) — the SAME list the org-scope gate uses (scripts/org-scope-check.mjs). */
export function companyTables(root: string): Set<string> {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "import { orgTablesFromMigrations } from './scripts/org-scope-check.mjs'; console.log(JSON.stringify([...orgTablesFromMigrations()]))"],
    { cwd: root, encoding: 'utf8' }
  )
  return new Set(JSON.parse(out) as string[])
}

const FK_COLUMNS = [
  'opportunity_id', 'user_id', 'lead_id', 'job_id', 'owner_user_id', 'project_id', 'customer_id', 'closer_user_id',
  'setter_user_id', 'team_id', 'custom_role_id', 'canvasser_user_id', 'proposal_id', 'payroll_period_id', 'assigned_sub_id',
  'region_id', 'manager_user_id', 'appointment_id', 'comp_plan_id', 'salesperson_id', 'accepted_proposal_id',
  'assigned_user_id', 'recipient_user_id', 'vendor_id', 'pin_attributed_user_id', 'linked_proposal_id',
  'financing_program_id', 'production_job_id', 'actor_user_id', 'territory_id', 'work_order_id', 'report_id',
  'invoice_id', 'activity_id', 'campaign_id', 'original_appointment_id', 'scheduled_appointment_id', 'estimate_id',
  'contract_id', 'change_order_id', 'deal_id', 'file_id', 'photo_id', 'sub_id', 'subcontractor_id', 'crew_id',
  'pricebook_id', 'template_id', 'document_id', 'inspection_id', 'measurement_id', 'thread_id', 'period_id',
  'created_by', 'updated_by', 'sender_user_id', 'author_user_id', 'requested_by', 'approved_by', 'property_id',
  'service_plan_id', 'roofing_type_id', 'item_id', 'line_id', 'payment_id', 'bonus_line_id', 'cost_line_id',
]
const TEXT_MARKERS = [
  'name', 'full_name', 'first_name', 'last_name', 'title', 'description', 'notes', 'note', 'body', 'content', 'message',
  'address', 'address_text', 'address_line1', 'street', 'project_address', 'customer_name', 'homeowner_name',
  'company_name', 'label', 'summary', 'subject', 'scope', 'legal_name', 'contact_name',
]
const MONEY = ['amount', 'total', 'sale_amount', 'price', 'cost', 'project_cost', 'estimated_value', 'contract_amount', 'balance']
const PATHS = ['storage_path', 'file_path', 'pdf_url', 'pdf_path', 'url', 'photo_url', 'image_url', 'cover_image_url', 'logo_url', 'signed_pdf_url', 'path']
const TOKENS = [
  'token', 'signing_token', 'public_token', 'share_token', 'crew_token', 'crew_link_token', 'report_token', 'webhook_token',
  'access_token', 'refresh_token',
]

/** Every `.from('<table>')` name used by the server code. */
export function tablesInCode(root: string): string[] {
  const names = new Set<string>()
  for (const f of walk(join(root, 'app')).concat(walk(join(root, 'lib')))) {
    if (!/\.(ts|tsx)$/.test(f) || f.includes(`${sep}__tests__${sep}`)) continue
    for (const m of Array.from(readFileSync(f, 'utf8').matchAll(/\.from\(\s*['"]([a-z_0-9]+)['"]\s*\)/g))) names.add(m[1])
  }
  return Array.from(names).sort()
}

export function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

export function victimRow(table: string, hasOrgId = true): Row {
  const r: Row = hasOrgId ? { id: VICTIM_ID, org_id: ORG_A } : { id: VICTIM_ID, [OWNER_TAG]: ORG_A }
  for (const k of FK_COLUMNS) r[k] = VICTIM_ID
  for (const k of TEXT_MARKERS) r[k] = `${MARK}_${table}_${k}`
  for (const k of MONEY) r[k] = A_AMOUNT
  for (const k of PATHS) r[k] = `org/${ORG_A}/${MARK}-${table}.pdf`
  for (const k of TOKENS) r[k] = A_TOKEN
  r.email = A_EMAIL
  r.phone = A_PHONE
  r.created_at = A_STAMP
  r.updated_at = A_STAMP
  return r
}

export function attackerSeed(table: string, hasOrgId = true): Row {
  const r: Row = { id: BRAVO_ROW_ID }
  for (const k of FK_COLUMNS) r[k] = BRAVO_ROW_ID
  for (const k of TEXT_MARKERS) r[k] = `Bravo ${table} ${k}`
  for (const k of TOKENS) r[k] = BRAVO_PUBLIC_TOKEN
  r.signing_token_hash = createHash('sha256').update(BRAVO_PUBLIC_TOKEN).digest('hex')
  // A live crew trade (lib/crew-link.ts needs trade + sub + a current date), so B's crew link resolves.
  // An enabled lead-source webhook, so B's webhook token is accepted.
  if (table === 'lead_sources') Object.assign(r, { webhook_enabled: true, is_active: true })
  if (table === 'work_orders') Object.assign(r, { trade: 'roofing', status: 'scheduled', install_days: 1, scheduled_date: new Date().toISOString().slice(0, 10) })
  // A live crew phone link (lib/service-plans-db.ts resolveCrewDay: unexpired), so B's crew day link resolves.
  if (table === 'crew_day_links') r.expires_at = new Date(Date.now() + 7 * 86_400_000).toISOString()
  // A live pay link (lib/online-payments/links.ts: hashed token, unexpired) and a connected Stripe account that can take
  // charges, so B's pay page and the billing routes get past "not set up" to B's own invoice.
  if (table === 'payment_links') Object.assign(r, { token_hash: createHash('sha256').update(BRAVO_PUBLIC_TOKEN).digest('hex'), kind: 'invoice', revoked_at: null, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
  // A SENT customer message whose link token is B's public token (lib/customer-messages-db.ts findMessageByToken: hashed
  // per-message token; /m/<token> and /api/m/<token>/unsubscribe only open a sent one) — a "done" visit email, so the
  // photos page and the unsubscribe reach B's own message, customer and visit.
  if (table === 'customer_messages') Object.assign(r, { link_token_hash: createHash('sha256').update(BRAVO_PUBLIC_TOKEN).digest('hex'), status: 'sent', kind: 'visit_done', channel: 'email', to_address: 'customer@bravo.test', sent_at: new Date().toISOString(), refs: { visitId: BRAVO_ROW_ID }, customer_id: BRAVO_ROW_ID })
  if (table === 'payment_accounts') Object.assign(r, { account_id: 'acct_BRAVO', status: 'active', charges_enabled: true, livemode: false, disconnected_at: null })
  Object.assign(r, { user_id: ATTACKER_ID, owner_user_id: ATTACKER_ID, created_at: '2026-11-02T12:00:00.000Z', updated_at: '2026-11-02T12:00:00.000Z' })
  if (hasOrgId) r.org_id = ORG_B
  else r[OWNER_TAG] = ORG_B
  return r
}

const ALL_CUSTOMER_MESSAGES_ON = { visitReminder: true, onTheWay: true, visitDone: true, quoteFollowUp: true, invoiceReminder: true }

/** Every default-OFF feature switch turned on (lib/org-features.ts) — new modules join automatically. */
const DEFAULT_OFF_MODULES_ON = Object.fromEntries(ORG_FEATURE_KEYS.filter((k) => !featureDefaultOn(k)).map((k) => [k, true]))

export function seedTables(tables: string[], orgTables: Set<string>, attackerRole = 'admin'): Record<string, Row[]> {
  const seed: Record<string, Row[]> = {}
  for (const t of tables) {
    if (GLOBAL_TABLES.has(t)) continue
    const org = orgTables.has(t) || t.startsWith('rpt_')
    seed[t] = [victimRow(t, org), attackerSeed(t, org)]
  }
  seed.orgs = [
    // Default-OFF modules are ON for both companies, so their routes are attacked past the feature gate (BOTH: a route
    // that checks the record's company switch must not be masked by A's being off).
    // Every automatic customer message on for both (lib/customer-messages.ts), so the crew "On my way" and the sender reach
    // the visit / customer instead of stopping at "turned off".
    { ...victimRow('orgs'), id: ORG_A, org_id: undefined, settings: { brand: { shortName: MARK }, features: DEFAULT_OFF_MODULES_ON, customerMessages: ALL_CUSTOMER_MESSAGES_ON }, subdomain: 'alpha' },
    { id: ORG_B, name: 'Bravo Co', email: 'office@bravo.test', address: '1 Bravo Way', settings: { features: DEFAULT_OFF_MODULES_ON, customerMessages: ALL_CUSTOMER_MESSAGES_ON }, subdomain: 'bravo', timezone: 'America/New_York' },
  ]
  seed.users = [
    { ...victimRow('users'), role: 'admin', is_super_admin: true, active: true },
    {
      id: ATTACKER_ID, org_id: ORG_B, role: attackerRole, is_super_admin: attackerRole === 'admin', active: true,
      email: 'boss@bravo.test', full_name: 'Bravo Boss', permissions: [],
    },
    // B's own rep under the shared B id, so user-id fields in the control run name a real B user (closer, foreman, owner).
    {
      ...attackerSeed('users'), id: BRAVO_ROW_ID, org_id: ORG_B, role: 'closer', is_super_admin: false, active: true,
      can_receive_appointments: true, email: 'rep@bravo.test', full_name: 'Bravo Rep', manager_user_id: ATTACKER_ID,
    },
  ]
  return seed
}

/**
 * Routes whose record is a special kind of a shared table: both companies' rows are made that kind (A's and B's alike,
 * before the "before" snapshot), so the attack reaches the org check instead of a "wrong kind" 404.
 */
export function seedForRoute(seed: Record<string, Row[]>, routePath: string) {
  // Service-plan visits are work_orders rows of type 'service_visit' with no job (lib/service-plans-db.ts).
  if (/^\/api\/(ops\/visits|crew\/day)\//.test(routePath)) {
    for (const r of seed.work_orders ?? []) Object.assign(r, { work_order_type: 'service_visit', visit_step: 'service', job_id: null, service_planned_date: r.scheduled_date ?? null })
  }
  // Payroll weeks + time entries: an OPEN week this week, and a finished shift in it, for both companies.
  if (/^\/api\/(admin\/payroll\/pay-week|my-pay|admin\/time)(\/|$)/.test(routePath)) {
    const cutoff = new Date(Date.now() + 3 * 86_400_000).toISOString()
    for (const r of seed.payroll_periods ?? []) Object.assign(r, { status: 'open', cutoff_at: cutoff, lock_at: cutoff, locked_at: null, lock_claimed_at: null, scheduled_pay_date: cutoff.slice(0, 10) })
    const start = new Date(Date.now() - 3 * 3_600_000).toISOString()
    for (const r of seed.time_entries ?? []) Object.assign(r, { kind: 'work', started_at: start, ended_at: new Date(Date.now() - 3_600_000).toISOString(), removed_at: null })
  }
  // Move from Jobber: both companies have an import draft with one file (lib/jobber-import/db.ts reads status + mapping).
  if (/^\/api\/admin\/import\/jobber/.test(routePath)) {
    for (const r of seed.import_runs ?? []) Object.assign(r, { status: 'draft', mapping: {}, options: {}, summary: null, checked_at: null })
    for (const r of seed.import_run_files ?? []) Object.assign(r, { kind: 'clients', headers: ['J-ID', 'Display Name'], rows: [['1_1', 'Pat']], row_count: 1, date_evidence: null, parsed: null, parsed_at: null })
  }
  // Time clock: both companies' crews clock in, and their crew_members rows are leads (lib/time-tracking-db.ts).
  if (/\/clock$/.test(routePath)) {
    for (const r of seed.sub_contractors ?? []) Object.assign(r, { tracks_time: true, active: true })
    for (const r of seed.crew_members ?? []) Object.assign(r, { is_lead: true })
  }
}

/**
 * Parent joins (`production_jobs!inner(org_id)` + `.eq('production_jobs.org_id', org)`) for every table: the embed name
 * is the parent table, found by the child's `<parent>_id` column. Without these an embedded company filter matched
 * nothing, so routes scoped that way (invoices via their job) refused B's own records too and were never reached.
 */
const PARENT_FK: Record<string, string> = {
  production_jobs: 'job_id', opportunities: 'opportunity_id', projects: 'project_id', payroll_periods: 'payroll_period_id',
  job_invoices: 'invoice_id', leads: 'lead_id', customers: 'customer_id', properties: 'property_id',
  service_plans: 'service_plan_id', sub_contractors: 'sub_id', proposals: 'proposal_id', users: 'user_id',
}
const PARENT_JOINS = new Proxy({} as Record<string, Record<string, { table: string; fk: string }>>, {
  get: () => Object.fromEntries(Object.entries(PARENT_FK).map(([t, fk]) => [t, { table: t, fk }])),
})

/** Both companies' invoices become no-job service invoices (customer_id + own org_id, lib/invoices.ts findOrgInvoice). */
export function noJobInvoices(seed: Record<string, Row[]>) {
  for (const r of seed.job_invoices ?? []) Object.assign(r, { job_id: null, kind: 'service', status: 'sent', total_cents: 10_000, balance_cents: 10_000 })
}

export type Finding = { kind: 'leak' | 'write' | 'insert_into_a' | 'moved_into_a' | 'storage' | 'auth_admin' | 'exfil'; detail: string }

/** Columns that point at shared reference tables (GLOBAL_TABLES): an id there is nobody's company data. */
const GLOBAL_REF_COLUMNS = new Set(['permission_id'])

export type World = ReturnType<typeof createWorld>

/** One fresh database + side-effect logs for one attack request. */
export function createWorld(tables: string[], orgTables: Set<string>, attackerRole = 'admin', routePath?: string, seedTweak?: (seed: Record<string, Row[]>) => void) {
  const rpcs: Array<{ name: string; args: Row }> = []
  const readsOfA: string[] = []
  const readsOfBRecord: string[] = []
  const seed = seedTables(tables, orgTables, attackerRole)
  if (routePath) seedForRoute(seed, routePath)
  seedTweak?.(seed)
  const db = createFakeDb(seed, {
    relations: PARENT_JOINS,
    // The portal's three SQL functions (supabase/migrations/202611120060_customer_portal.sql). Limits always allow here:
    // the suite is about whose rows a request reaches, not how often (lib/__tests__/customer-portal.test.ts does limits).
    rpc: {
      portal_take_attempt: () => true,
      portal_find_customers: () => [],
      portal_consume_login_token: (args, t) => {
        const row = (t.portal_login_tokens ?? []).find((r) => r.token_hash === args.p_hash && !r.used_at)
        if (!row) return []
        row.used_at = new Date().toISOString()
        return [{ org_id: row.org_id, customer_id: row.customer_id }]
      },
    },
    onRpc: (name, args) => rpcs.push({ name, args }),
    onSelect: (table, rows) => {
      if (rows.some((r) => ownerOf(table, r) === ORG_A)) readsOfA.push(table)
      if (rows.some((r) => r.id === BRAVO_ROW_ID)) readsOfBRecord.push(table)
    },
  })
  const before = snapshotA(db.tables)
  const storage: Array<{ bucket: string; op: string; arg: string }> = []
  const authAdmin: Array<{ op: string; arg: string }> = []
  const outbound: string[] = []
  return { db, before, rpcs, readsOfA, readsOfBRecord, storage, authAdmin, outbound }
}

/** Did the request get through to company B's data — read B's record, or write any B row? (control-run "reach") */
export function reachedB(w: World): boolean {
  if (w.readsOfBRecord.length > 0) return true
  return w.db.writes.some((x) => x.rows.some((r) => ownerOf(x.table, r) === ORG_B || r.id === BRAVO_ROW_ID))
}

/** Which company a seeded row belongs to (org_id, the orgs row itself, or the hidden tag on child rows). */
export function ownerOf(table: string, r: Row): unknown {
  return table === 'orgs' ? r.id : r.org_id ?? r[OWNER_TAG]
}

function snapshotA(tables: Record<string, Row[]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [t, rows] of Object.entries(tables)) {
    for (const r of rows) if (ownerOf(t, r) === ORG_A || r.id === VICTIM_ID) m.set(`${t}:${String(r.id)}`, JSON.stringify(r))
  }
  return m
}

/** Did this attack read, change or ship anything of company A's? */
export function findings(w: World, responseText: string): Finding[] {
  const out: Finding[] = []
  const hit = (s: string) => LEAK_PATTERNS.find((p) => s.includes(p))
  const leak = hit(responseText)
  if (leak) out.push({ kind: 'leak', detail: `response contains ${leak}: ${excerpt(responseText, leak)}` })
  const after = snapshotA(w.db.tables)
  for (const [k, v] of Array.from(w.before)) {
    const now = after.get(k)
    if (now === undefined) out.push({ kind: 'write', detail: `deleted ${k}` })
    else if (now !== v) out.push({ kind: 'write', detail: `changed ${k}: ${diff(JSON.parse(v), JSON.parse(now))}` })
  }
  // A row of B's (or a new row) that now belongs to A: moved into another company by an update.
  for (const k of Array.from(after.keys())) {
    if (!w.before.has(k) && !w.db.writes.some((x) => (x.op === 'insert' || x.op === 'upsert') && `${x.table}:` === k.slice(0, x.table.length + 1))) {
      out.push({ kind: 'moved_into_a', detail: `${k} now belongs to company A` })
    }
  }
  for (const wr of w.db.writes) {
    if (wr.op !== 'insert' && wr.op !== 'upsert') continue
    for (const r of wr.rows) {
      // The portal sign-in audit is written against the company whose web address was used: anonymous attempts (no customer, only the sign-in kinds) on A's own address belong in A's log.
      if (wr.table === 'portal_login_events' && ownerOf(wr.table, r) === ORG_A && r.customer_id == null && ['link_requested', 'login_failed', 'link_blocked', 'link_no_match'].includes(String(r.kind))) continue
      if (ownerOf(wr.table, r) === ORG_A) out.push({ kind: 'insert_into_a', detail: `${wr.op} ${wr.table} with company A org_id` })
      // A row with no org_id hangs off its parent: one pointing at A's record lands in A's data (e.g. a payment on A's job).
      else if (!('org_id' in r) && !(OWNER_TAG in r)) {
        const cols = Object.entries(r).filter(([k, v]) => v === VICTIM_ID && k !== 'id' && !GLOBAL_REF_COLUMNS.has(k)).map(([k]) => k)
        if (cols.length) out.push({ kind: 'insert_into_a', detail: `${wr.op} ${wr.table} (no org_id) pointing at A via ${cols.join('/')}` })
      }
    }
  }
  const hitPath = (s: string) => PATH_PATTERNS.find((p) => s.includes(p))
  for (const s of w.storage) {
    // A's record id inside B's own folder (e.g. searching B's uploads for a name) is not A's storage.
    const p = hitPath(s.arg) ?? (s.arg.includes(VICTIM_ID) && !s.arg.includes(ORG_B) ? VICTIM_ID : undefined)
    if (p) out.push({ kind: 'storage', detail: `storage ${s.bucket}.${s.op}(${s.arg})` })
  }
  for (const a of w.authAdmin) if (a.arg.includes(VICTIM_ID) || hitPath(a.arg)) out.push({ kind: 'auth_admin', detail: `auth.admin.${a.op}(${a.arg})` })
  for (const o of w.outbound) { const p = hit(o); if (p) out.push({ kind: 'exfil', detail: `outbound carries ${p}: ${excerpt(o, p)}` }) }
  return out
}

/** Writes (insert, upsert or update) by company B that leave a B row pointing at company A's record (a column =
 * VICTIM_ID): a cross-company reference. */
let columnsCache: Map<string, Set<string>> | null = null
export function crossReferences(w: World, root?: string): string[] {
  if (root && !columnsCache) columnsCache = tableColumns(root)
  const out: string[] = []
  for (const wr of w.db.writes) {
    if (wr.op === 'delete') continue
    const cols = columnsCache?.get(wr.table)
    for (const r of wr.rows) {
      if (r.org_id === ORG_A || !('org_id' in r)) continue
      for (const [k, v] of Object.entries(r)) {
        if (v !== VICTIM_ID || k === 'id' || GLOBAL_REF_COLUMNS.has(k)) continue
        if (cols && !cols.has(k.toLowerCase())) continue // not a real column: the real write would be refused
        out.push(`${wr.table}.${k}`)
      }
    }
  }
  return out
}

function excerpt(s: string, p: string) {
  const i = s.indexOf(p)
  return s.slice(Math.max(0, i - 80), i + 60).replace(/\s+/g, ' ')
}

function diff(a: Row, b: Row) {
  return Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}→${JSON.stringify(b[k])}`).join(', ').slice(0, 200)
}

/** `app/api/x/[id]/route.ts` → `/api/x/[id]` */
export function routePathOf(root: string, file: string) {
  return '/' + relative(join(root, 'app'), file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/')
}

/**
 * For background jobs that run for EVERY company (crons): did one company's data end up in the other's? A row written
 * for one company that points at the other's record, or an email to one company's people carrying the other's data.
 */
export function crossings(w: World): string[] {
  const out: string[] = []
  for (const wr of w.db.writes) {
    if (wr.op === 'delete') continue
    for (const r of wr.rows ?? []) {
      const org = ownerOf(wr.table, r)
      const foreign = org === ORG_B ? VICTIM_ID : org === ORG_A ? BRAVO_ROW_ID : null
      if (!foreign) continue
      const cols = Object.entries(r).filter(([k, v]) => v === foreign && k !== 'id').map(([k]) => k)
      if (cols.length) out.push(`${wr.op} ${wr.table} for ${org === ORG_A ? 'A' : 'B'} points at the other company via ${cols.join('/')}`)
    }
  }
  for (const o of w.outbound) {
    if (!o.startsWith('mail ')) continue
    let recipients = ''
    try {
      const m = JSON.parse(o.slice(5)) as { to?: unknown; cc?: unknown; bcc?: unknown }
      recipients = JSON.stringify([m.to, m.cc, m.bcc])
    } catch { continue }
    if (/bravo\.test/.test(recipients) && LEAK_PATTERNS.some((p) => o.includes(p))) out.push(`mail to company B carries company A data: ${excerpt(o, 'ALPHA')}`)
    if (/alpha\.test/.test(recipients) && o.includes('Bravo')) out.push(`mail to company A carries company B data: ${excerpt(o, 'Bravo')}`)
  }
  return out
}

/** What a route reads from the request, found by scanning its source (no schemas in this codebase). */
export type RequestShape = { body: string[]; query: string[]; form: string[]; multipart: boolean }

export function requestShape(file: string): RequestShape {
  const src = readFileSync(file, 'utf8')
  const body = new Set<string>()
  const query = new Set<string>()
  const form = new Set<string>()
  // body.x / body?.x / rawBody.x / payload.x / json.x / input.x
  for (const m of Array.from(src.matchAll(/\b(?:body|rawBody|payload|json|input|data|parsed)\??\.([A-Za-z_][A-Za-z0-9_]*)/g))) body.add(m[1])
  // const { a, b: c, d = 1 } = body / await request.json() / await req.json()
  for (const m of Array.from(src.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*(?::[^=]+)?=\s*(?:\(?await\s+\w+\.json\(\)|body|rawBody|payload|json|input)\b/g))) {
    for (const part of m[1].split(',')) {
      const k = part.trim().split(/[:=\s]/)[0]
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) body.add(k)
    }
  }
  for (const m of Array.from(src.matchAll(/searchParams\.get(?:All)?\(\s*['"]([^'"]+)['"]/g))) query.add(m[1])
  for (const m of Array.from(src.matchAll(/\b(?:form|formData|fd)\.get(?:All)?\(\s*['"]([^'"]+)['"]/g))) form.add(m[1])
  const drop = new Set(['length', 'map', 'filter', 'forEach', 'some', 'every', 'trim', 'toString', 'then', 'error', 'data'])
  const clean = (s: Set<string>) => Array.from(s).filter((k) => !drop.has(k)).sort()
  return { body: clean(body), query: clean(query), form: clean(form), multipart: /\.formData\(\)/.test(src) }
}

/** A plausible value for a request field, guessed from its name; ids get `id`. */
export function guessValue(key: string, id: string, org: string): unknown {
  const k = key.toLowerCase()
  if (k === 'org_id' || k === 'orgid') return org
  if (/calendar/.test(k)) return 'crew@bravo.test'
  if (k === 'month') return '2026-11'
  if (k === 'week' || k === 'week_start' || k === 'weekstart') return '2026-11-09'
  if (k === 'role') return 'closer'
  if (k === 'preset') return 'mtd'
  if (/password/.test(k)) return 'Bravo-pass-123'
  if (k === 'permission') return 'reports:financials'
  if (k === 'mode') return 'grant'
  if (k === 'title' || k === 'summary') return 'Bravo title'
  if (/(^|_)ids$|ids$/.test(key) || /Ids$/.test(key)) return [id]
  if (/(^id$|_id$|Id$)/.test(key)) return id
  if (/email/.test(k)) return 'bravo@bravo.test'
  if (/phone/.test(k)) return '7045550123'
  if (/(date|day|start|end|from|to|until|since|_on$)/.test(k) && !/update/.test(k)) return /time|_at$/.test(k) ? '2026-11-12T15:00:00.000Z' : '2026-11-12'
  if (/(_at$|time|datetime)/.test(k)) return '2026-11-12T15:00:00.000Z'
  if (/^(is|has|can|should|allow|send|enabled|active|confirm|final|force|include)/.test(k) || /(enabled|_flag)$/.test(k)) return true
  if (/(amount|price|cost|total|qty|quantity|count|rate|percent|hours|minutes|days|squares|sq|lf|lat|lng|lon|pitch|limit|offset|page|size|number|num|year|month|week|value|score|duration)/.test(k)) return 10
  if (/(items|lines|rows|entries|list|members|users|steps|photos|files|messages|tags)$/.test(k)) return [{ id, name: 'bravo', amount: 10 }]
  if (/(settings|config|options|meta|filters|prefs|patch|updates|changes|fields)$/.test(k)) return { id }
  if (/(lat|lng)$/.test(k)) return 35.4
  return 'bravo'
}

/**
 * Columns per table, read from the migrations (CREATE TABLE bodies + ALTER TABLE … ADD COLUMN). The fake database
 * accepts any column, but PostgREST rejects a write naming a column that does not exist — so a cross-reference is only
 * real when the column is. Tables the parser cannot see are not filtered.
 */
export function tableColumns(root: string): Map<string, Set<string>> {
  const dir = join(root, 'supabase', 'migrations')
  const out = new Map<string, Set<string>>()
  const add = (t: string, c: string) => { const s = out.get(t) ?? new Set<string>(); s.add(c.toLowerCase()); out.set(t, s) }
  for (const f of readdirSync(dir).filter((x) => /^\d.*\.sql$/.test(x)).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8')
    for (const m of Array.from(sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi))) {
      for (const line of m[2].split('\n')) {
        const c = line.trim().match(/^"?([a-z_][a-z_0-9]*)"?\s+[a-z]/i)
        if (c && !/^(constraint|primary|unique|foreign|check|exclude)$/i.test(c[1])) add(m[1].toLowerCase(), c[1])
      }
    }
    for (const m of Array.from(sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?([\s\S]*?);/gi))) {
      for (const c of Array.from(m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z_0-9]*)"?/gi))) add(m[1].toLowerCase(), c[1])
    }
  }
  return out
}
