import { expect, test, type Page } from '@playwright/test'

import { REPORT_TEMPLATES } from '../lib/reporting/templates'
import { JOB_SETUP_TRADES, HARNESS_TRADES_0037, HARNESS_PAYMENTS_0037, SUPPLIER_VIEW_0037, HARNESS_INCENTIVES, HARNESS_LEADERBOARD, HARNESS_INSIDE_SALES, HARNESS_INSTALL_SCHEDULE, HARNESS_PARTNERS, HARNESS_APPOINTMENTS, HARNESS_THREAD, HARNESS_PROPOSALS, HARNESS_LEADS, ANNOUNCEMENTS, BANNER, DEFAULT_PLANS, COST_LINES, SUPPLIERS, PAY_WEEK, MY_PAY, REPORT_RESULT, SALE_CREDIT, SUPPLIER_PREVIEW, SUPPLIER_VIEW, TEMPLATE_META, USERS, HARNESS_OWNER_CANDIDATES, HARNESS_CUSTOM_FIELDS, HARNESS_PROPERTIES, HARNESS_SERVICE_PLANS, HARNESS_VISITS, HARNESS_PLAN_TEMPLATES, HARNESS_TEMPLATE_DETAIL, HARNESS_READY_TO_BILL, HARNESS_HOURS_TO_BILL, HARNESS_JOB_HOURLY, HARNESS_HOURLY_SETTINGS, HARNESS_CUSTOMER_INVOICES, HARNESS_CLOCK_STATE, HARNESS_CLOCK_STATE_IN, HARNESS_JOB_CLOCK_SELF, HARNESS_TIME_WEEK, HARNESS_CREW_SETUP, JOB_SPLIT, PAY_WEEK_SCHEDULE, PAY_WEEK_SCHEDULE_PREVIEW, HARNESS_JOBBER_STATE, HARNESS_JOBBER_DONE, HARNESS_JOBBER_RUN } from './fixtures'

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockApi(page: Page) {
  await page.route('**/api/me/effective-permissions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner', fullAccess: true, permissions: [] }) }))
  // Any direct Supabase call from a component (browser client) gets an empty answer.
  await page.route('http://127.0.0.1:9/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    const m = route.request().method()
    if (/\/api\/ops\/jobs\/[^/]+\/payments$/.test(p)) return route.fulfill(json({ payments: [{ id: 'pay1', job_id: 'job-1', paid_at: '2026-10-10', amount_cents: 1632500, payment_type: 'final', method: 'financing', payer: 'financing', note: null, created_at: '2026-10-10T12:00:00Z', created_by: 'u1', funding_status: 'cleared' }], collected_cents: 1632500, collected_dollars: 16325, sale_amount_cents: 1632500, sale_amount_dollars: 16325, remaining_cents: 0, remaining_dollars: 0, payment_count: 1, paid_in_full: true, paid_by_payments: true }))
    if (/\/api\/ops\/jobs\/[^/]+\/notes$/.test(p)) return route.fulfill(json({ notes: [{ id: 'n1', note: 'Customer asked for the crew to park on the street, not the driveway. @Stevo Potts please confirm the dumpster drop.', is_internal: true, created_at: '2026-10-11T14:00:00Z', user: { full_name: 'Nathan Hall' } }] }))
    if (/\/api\/ops\/jobs\/[^/]+\/trades$/.test(p)) return route.fulfill(json({ trades: [] }))
    if (p.endsWith('/supplier-orders/preview')) return route.fulfill(json(SUPPLIER_PREVIEW))
    if (p.endsWith('/supplier-orders')) return route.fulfill(json(SUPPLIER_VIEW))
    if (p.endsWith('/cost-lines')) return route.fulfill(json(COST_LINES))
    if (p === '/api/reports/run') return route.fulfill(json(m === 'GET' ? TEMPLATE_META(REPORT_TEMPLATES.filter((t) => !t.finance || true)) : REPORT_RESULT))
    if (p === '/api/reports/saved') return route.fulfill(json({ reports: [{ id: 's1', name: 'Inspections Scheduled', spec: REPORT_TEMPLATES[0].spec, schedule: 'daily', created_by: 'u1' }], me: 'u1' }))
    if (p === '/api/announcements/active') return route.fulfill(json(BANNER))
    if (p === '/api/admin/announcements') return route.fulfill(json(ANNOUNCEMENTS))
    if (p === '/api/admin/suppliers') return route.fulfill(json(SUPPLIERS))
    if (p === '/api/admin/payroll/pay-week') return route.fulfill(json(PAY_WEEK))
    if (p === '/api/admin/payroll/pay-week/job-split') return route.fulfill(json(JOB_SPLIT))
    if (p === '/api/admin/payroll/pay-week/schedule') return route.fulfill(json(m === 'GET' ? PAY_WEEK_SCHEDULE : PAY_WEEK_SCHEDULE_PREVIEW))
    if (p === '/api/me/pay') return route.fulfill(json(MY_PAY))
    if (p === '/api/sisu/leaderboard') return route.fulfill(json(HARNESS_LEADERBOARD))
    if (p === '/api/ops/install-schedule') return route.fulfill(json(HARNESS_INSTALL_SCHEDULE))
    if (p === '/api/referral-partners') return route.fulfill(json(HARNESS_PARTNERS))
    if (p === '/api/appointments') return route.fulfill(json(HARNESS_APPOINTMENTS))
    if (p === '/api/proposals') return route.fulfill(json(HARNESS_PROPOSALS))
    if (p === '/api/leads') return route.fulfill(json(HARNESS_LEADS))
    if (p === '/api/opportunities') return route.fulfill(json({ opportunities: [{ id: 'o1', lead_id: 'l2', customer_id: 'c2', owner_user_id: 'u1', address_text: '88 Oak Ave, Kannapolis NC', project_type: 'roofing', status: 'open', created_at: '2026-10-19T12:00:00Z', customers: { name: 'Bill Cox' }, leads: { homeowner_name: 'Bill Cox' }, users: { full_name: 'Sam Closer' }, inspection_outcome: null, inspection_notes: null, inspection_date: null }, { id: 'o2', lead_id: null, customer_id: 'c1', owner_user_id: 'u1', address_text: '1423 Maple Ridge Dr, Concord NC', project_type: 'roofing', status: 'won', created_at: '2026-10-01T12:00:00Z', customers: { name: 'Ashley Gaines' }, leads: null, users: { full_name: 'Nathan Hall' }, inspection_outcome: 'sale', inspection_notes: null, inspection_date: null }] }))
    if (p === '/api/opportunities/inside-sales') return route.fulfill(json(HARNESS_INSIDE_SALES))
    if (p === '/api/inspections/outcomes') return route.fulfill(json({ outcomes: [] }))
    if (/\/api\/threads\/[^/]+\/messages$/.test(p)) return route.fulfill(json(m === 'POST' ? { message: HARNESS_THREAD.messages[0] } : HARNESS_THREAD))
    if (/\/api\/threads\/[^/]+\/mentionable$/.test(p)) return route.fulfill(json({ users: [{ id: 'u3', full_name: 'Riley Ops' }, { id: 'u1', full_name: 'Jordan Setter' }] }))
    if (/\/api\/threads\/[^/]+\/read$/.test(p)) return route.fulfill(json({ ok: true }))
    if (p === '/api/file-prefs') return route.fulfill(json({ ok: true }))
    if (p.endsWith('/sale-credit')) return route.fulfill(json(SALE_CREDIT))
    if (p === '/api/referral-partners/summary') return route.fulfill(json({ assigned_count: 9, opening_soon: [{ id: 'rp1', name: 'Concord Realty Group', days_until_open: 3 }], opening_soon_count: 1, jobs_this_month: 2 }))
    if (p === '/api/admin/comp-plans/defaults') return route.fulfill(json(DEFAULT_PLANS))
    if (p === '/api/users') return route.fulfill(json(USERS))
    if (p.includes('/effective-permissions')) return route.fulfill(json({ permissions: [], fullAccess: true }))
    return route.fulfill(json({}))
  })
}

/** Answers for a job shaped like 26-0037. Registered after mockApi, so these win. */
async function mockJob0037(page: Page) {
  await page.route('**/api/ops/jobs/*/trades', (route) => route.fulfill(json(HARNESS_TRADES_0037)))
  await page.route('**/api/ops/jobs/*/payments', (route) => route.fulfill(json(HARNESS_PAYMENTS_0037)))
  await page.route('**/api/ops/jobs/*/supplier-orders', (route) => route.fulfill(json(SUPPLIER_VIEW_0037)))
  await page.route('**/api/ops/jobs/*/run-sheet/email', (route) => route.fulfill(json({ recipients: [{ email: 'sparky@example.test', name: 'Sparky Roofing LLC' }] })))
}

type Screen = { name: string; path: string; ready: string; mock?: (page: Page) => Promise<void>; states?: Array<{ name: string; run: (page: Page) => Promise<void> }> }

const SCREENS: Screen[] = [
  { name: 'force-paid-dialog', path: '/dev-harness/force-paid', ready: 'textarea, input' },
  { name: 'sale-credit-confirm', path: '/dev-harness/sale-credit', ready: 'text=Send Agreement',
    states: [{ name: 'credit-step', run: async (p) => {
      for (let i = 0; i < 3; i++) {
        if (await p.getByText('Sale credit', { exact: true }).first().isVisible().catch(() => false)) break
        await p.getByRole('button', { name: 'Next' }).click()
        await p.waitForTimeout(250)
      }
      await p.waitForSelector('text=Sale credit')
    } }] },
  { name: 'needs-you', path: '/dev-harness/needs-you', ready: 'text=Needs you' },
  { name: 'checkups', path: '/dev-harness/checkups', ready: 'text=6-month inspection',
    states: [
      { name: 'result-sheet', run: async (p) => { await p.getByRole('button', { name: 'Record result' }).first().click(); await p.waitForSelector('text=How did the roof look?') } },
      { name: 'contact-sheet', run: async (p) => { await p.getByRole('button', { name: '+ Log contact' }).first().click(); await p.waitForSelector('text=How did it go?') } },
    ] },
  { name: 'job-documents-banner', path: '/dev-harness/job-documents', ready: 'text=Job documents' },
  { name: 'pay-banners', path: '/dev-harness/pay-banners', ready: 'text=Mark' },
  { name: 'suppliers-admin', path: '/dev-harness/suppliers-admin', ready: 'text=Suppliers',
    states: [{ name: 'edit', run: async (p) => { await p.getByRole('button', { name: /Edit ABC Supply/ }).click(); await p.waitForSelector('text=Edit supplier') } }] },
  { name: 'announcement-banner', path: '/dev-harness/announcement-banner', ready: 'text=See what',
    states: [{ name: 'size', run: async (p) => {
      const box = await p.getByRole('region', { name: "What's new" }).boundingBox()
      const main = await p.getByRole('button', { name: 'Page main action' }).boundingBox()
      const vp = p.viewportSize()!
      // banner text clamps to two lines on phones (~44-70px tall) and never covers the page's main action
      if (!box || box.height > 96) throw new Error(`banner too tall on a phone: ${box?.height}px`)
      if (box.width > vp.width) throw new Error('banner wider than the screen')
      if (!main || main.y < box.y + box.height - 1) throw new Error('banner overlaps the page main action')
    } }] },
  { name: 'email-blasts', path: '/dev-harness/email-blasts', ready: 'text=Owner Morning Update', mock: async (p) => {
    const users = [
      { id: 'u-nathan', full_name: 'Nathan Hall', email: 'nathan@example.test', role: 'admin', active: true },
      { id: 'u-andrew', full_name: 'Andrew Waltz', email: 'andrew@example.test', role: 'admin', active: true },
    ]
    const blast = (enabled: boolean) => ({ enabled, role_targets: [], user_targets: ['u-nathan', 'u-andrew'] })
    await p.route('**/api/admin/email-blasts', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      definitions: [{ id: 'morning_update', title: 'Owner Morning Update', description: 'Daily email.' }],
      roleOptions: [{ role: 'owner', label: 'Owner' }, { role: 'admin', label: 'Admin' }],
      settings: { sale: blast(false), job_payment: blast(false), setter_field_update: blast(false), morning_update: { ...blast(true), user_focus: { 'u-andrew': 'crews' } } },
      users,
    }) }))
  } },
  { name: 'announcements-admin', path: '/dev-harness/announcements-admin', ready: 'text=Announcements',
    states: [{ name: 'edit', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).click(); await p.waitForSelector('text=Edit announcement') } }] },
  { name: 'materials-cost-entry', path: '/dev-harness/materials-costs', ready: 'text=Total job costs',
    states: [{ name: 'add-cost-open', run: async (p) => { await p.getByRole('button', { name: /Job Cost/i }).first().click(); await p.waitForTimeout(300) } }] },
  { name: 'contract-signing', path: '/dev-harness/contract-signing', ready: 'text=Pat Customer',
    states: [{ name: 'notice-of-cancellation-open', run: async (p) => {
      await p.getByRole('button', { name: 'Notice of Cancellation' }).click()
      await p.waitForSelector('text=I HEREBY CANCEL THIS TRANSACTION.')
    } }] },
  { name: 'change-order-signing', path: '/dev-harness/change-order-signing', ready: 'text=CO-1' },
  { name: 'crew-photo-capture', path: '/dev-harness/crew-capture', ready: 'text=Front of house' },
  { name: 'payroll-attribution', path: '/dev-harness/payroll-attribution', ready: 'text=Payroll attribution' },
  { name: 'ops-dashboard', path: '/dev-harness/ops-dashboard', ready: 'text=Operations Dashboard',
    states: [{ name: 'pipeline-tiles', run: async (p) => {
      // Five tiles in a 2-column grid with the full words (Sold / Materials / Scheduled / In progress / Completed).
      const labels = ['Sold', 'Materials', 'Scheduled', 'In progress', 'Completed']
      const xs = new Set<number>()
      for (const l of labels) {
        const el = p.getByRole('link', { name: new RegExp(`${l}$`) }).first()
        await el.waitFor()
        xs.add(Math.round((await el.boundingBox())!.x))
      }
      if (xs.size !== 2) throw new Error(`pipeline tiles should sit in 2 columns, found ${xs.size}`)
    } }] },
  { name: 'ops-schedule', path: '/dev-harness/ops-schedule', ready: 'text=26-0044' },
  { name: 'referral-partners', path: '/dev-harness/referral-partners', ready: 'text=Concord Realty Group' },
  { name: 'inside-sales', path: '/dev-harness/inside-sales', ready: 'text=Featherstonehaugh' },
  { name: 'incentives', path: '/dev-harness/incentives', ready: 'text=Doors Knocked',
    states: [{ name: 'leaderboard', run: async (p) => { await p.getByRole('button', { name: /Leaderboard/i }).first().click(); await p.waitForSelector('text=Bartholomew >> visible=true') } }] },
  { name: 'projects', path: '/dev-harness/projects', ready: 'text=Featherstonehaugh' },
  { name: 'ops-board', path: '/dev-harness/ops-board', ready: 'text=26-0041',
    states: [{ name: 'board-view', run: async (p) => { await p.getByRole('button', { name: 'Board', exact: true }).click(); await p.waitForTimeout(300) } }] },
  { name: 'job-page', path: '/dev-harness/job-page', ready: 'text=26-0042',
    states: ['Details', 'Materials', 'Financials', 'Photos & files', 'Notes'].map((tab) => ({
      name: `tab-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      run: async (p: Page) => { await p.getByRole('button', { name: tab, exact: true }).click(); await p.waitForTimeout(500) },
    })) },
  { name: 'supplier-orders', path: '/dev-harness/supplier-orders', ready: 'text=Supplier orders',
    states: [{ name: 'preview-open', run: async (p) => { await p.getByRole('button', { name: /Send order to ABC Supply/ }).click(); await p.waitForSelector('text=Send to ABC Supply') } }] },
  { name: 'reports-home', path: '/dev-harness/reports-home', ready: 'text=Performance at a glance' },
  { name: 'reports-explore', path: '/dev-harness/reports-explore', ready: 'text=Sales by closer',
    states: [
      { name: 'chart', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.waitForSelector('text=Nathan Hall') } },
      { name: 'table', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByRole('button', { name: 'Show table' }).click() } },
      { name: 'drill', run: async (p) => { await p.getByRole('button', { name: 'Sales by closer' }).click(); await p.getByText('Nathan Hall').first().click() } },
    ] },
  { name: 'job-sheets-editor', path: '/dev-harness/job-sheets', ready: 'text=Scope of work',
    states: [{ name: 'editing', run: async (p) => { await p.locator('textarea').first().click(); await p.locator('textarea').first().fill('Edited scope for the crew.'); await p.waitForTimeout(200) } }] },
  { name: 'dashboard-tiles', path: '/dev-harness/dashboard', ready: 'text=Doors' },
  { name: 'nav-shell', path: '/dev-harness/nav', ready: 'text=Page content',
    states: [{ name: 'search-open', run: async (p) => { await p.route('**/api/search**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ kind: 'customer', id: 'c1', title: 'ASHLEY GAINES', subtitle: '1001 LYERLY RIDGE RD NW, CONCORD NC 28027 · (704)707-6274', href: '#' }, { kind: 'proposal', id: 'p1', title: 'ASHLEY P GAINES · #P-00118', subtitle: '(704)707-6274 · accepted', href: '#' }, { kind: 'job', id: 'j1', title: 'Job 26-0026', subtitle: '1001 LYERLY RIDGE RD NW · complete', href: '#' }] }) }));
      await p.getByRole('button', { name: 'Search' }).first().click(); await p.getByRole('combobox', { name: 'Search' }).fill('gaienes'); await p.waitForSelector('text=ASHLEY GAINES') } }, { name: 'more-open', run: async (p) => { await p.getByRole('button', { name: 'More' }).click(); await p.waitForSelector('[role=dialog] >> text=Logout') } }] },
  { name: 'job-setup', path: '/dev-harness/job-setup', ready: 'text=Solar panel removal & reinstall', mock: async (p) => {
    await p.route('**/api/admin/job-setup/trades', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JOB_SETUP_TRADES) }))
  },
    states: [
      { name: 'renaming', run: async (p) => { await p.getByRole('button', { name: 'Rename' }).first().click(); await p.waitForSelector('input[aria-label="New name for Roofing"]') } },
      { name: 'adding', run: async (p) => { await p.getByLabel('Add a trade').fill('Painting'); await p.waitForTimeout(100) } },
    ] },
  { name: 'move-from-jobber', path: '/dev-harness/move-from-jobber', ready: 'text=2. Check before anything is saved', mock: async (p) => {
    await p.route(/\/api\/admin\/import\/jobber$/, (route) => route.fulfill(json({ ready: true, runs: [HARNESS_JOBBER_RUN] })))
    await p.route(/\/api\/admin\/import\/jobber\/[^/]+$/, (route) => route.fulfill(json(HARNESS_JOBBER_STATE)))
  },
    states: [
      { name: 'columns-sheet', run: async (p) => { await p.getByRole('button', { name: /column to check/ }).click(); await p.waitForSelector('[role=dialog] >> text=Mowing height') } },
      { name: 'how-to-export', run: async (p) => { await p.getByText('How to get these files out of Jobber').click(); await p.waitForSelector('text=More Actions → Export Clients') } },
    ] },
  { name: 'move-from-jobber-done', path: '/dev-harness/move-from-jobber-done', ready: 'text=Plans to check before they start', mock: async (p) => {
    await p.route(/\/api\/admin\/import\/jobber$/, (route) => route.fulfill(json({ ready: true, runs: [{ ...HARNESS_JOBBER_RUN, status: 'done' }] })))
    await p.route(/\/api\/admin\/import\/jobber\/[^/]+$/, (route) => route.fulfill(json(route.request().method() === 'POST' ? { matches: [{ fileName: 'Jane Smith - Contract.pdf', customerId: 'c1', how: 'exact', candidates: [{ id: 'c1', name: 'Jane Smith' }], title: 'Contract' }], customers: [{ id: 'c1', name: 'Jane Smith' }, { id: 'c2', name: 'Wakulla HOA' }] } : HARNESS_JOBBER_DONE)))
  },
    states: [
      { name: 'file-match', run: async (p) => { await p.setInputFiles('input[type=file]', { name: 'Jane Smith - Contract.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') }); await p.waitForSelector('text=Add 1 file to customers') } },
    ] },
  { name: 'custom-fields-admin', path: '/dev-harness/custom-fields-admin', ready: 'text=Payment terms', mock: async (p) => {
    await p.route('**/api/admin/custom-fields', (route) => route.fulfill(json(HARNESS_CUSTOM_FIELDS)))
  },
    states: [
      { name: 'properties-tab', run: async (p) => { await p.getByRole('tab', { name: 'Properties' }).click(); await p.waitForSelector('text=Mowing day') } },
      { name: 'add-dropdown', run: async (p) => { await p.getByLabel('Field type').selectOption('dropdown'); await p.waitForSelector('text=One per line.') } },
      { name: 'choices-sheet', run: async (p) => { await p.getByRole('button', { name: 'Choices & settings' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Dropdown field') } },
    ] },
  { name: 'customer-records', path: '/dev-harness/customer-records', ready: 'text=Gate code 4421', mock: async (p) => {
    await p.route('**/api/properties/**', (route) => route.fulfill(json({ property: HARNESS_PROPERTIES[0] })))
    await p.route('**/api/custom-fields/values', (route) => route.fulfill(json({ values: { 'cf-gate': 'Dana', 'cf-terms': 'Net 30' } })))
  },
    states: [
      { name: 'property-sheet', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).nth(1).click(); await p.waitForSelector('[role=dialog] >> text=Gate / access notes') } },
      { name: 'add-property', run: async (p) => { await p.getByRole('button', { name: '+ Add property' }).click(); await p.waitForSelector('[role=dialog] >> text=Street address *') } },
      { name: 'details-editing', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).first().click(); await p.waitForSelector('text=Payment terms *') } },
      { name: 'turned-off', run: async (p) => { await p.getByRole('button', { name: /Show turned-off properties/ }).click(); await p.waitForSelector('text=5 Old Shell Rd, Medart, FL 32327') } },
    ] },
  { name: 'customer-records-plain', path: '/dev-harness/customer-records-plain', ready: 'text=+ Add another property' },
  { name: 'service-plans', path: '/dev-harness/service-plans', ready: 'text=Weekly mowing & edging', mock: async (p) => {
    await p.route('**/api/customers/*/service-plans', (route) => route.fulfill(json(HARNESS_SERVICE_PLANS)))
    await p.route('**/api/service-plans/*/history', (route) => route.fulfill(json({ history: [{ id: 'h1', action: 'updated', at: '2026-11-01T12:00:00Z', by: 'Office', lines: ['Price: 45 → 55'], effect: { removed: 0, added: 0, updated: 5 } }] })))
    await p.route(/\/api\/service-plans\/[^/]+$/, (route) => route.fulfill(json({ ok: true, preview: true, effect: { removed: 5, added: 6, updated: 0 }, changes: [{ field: 'preferred_weekday', label: 'Visit day', old: 2, new: 4 }], summary: '5 upcoming visits removed, 6 added. Done, skipped and today’s visits don’t change.' })))
  },
    states: [
      { name: 'editor', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).first().click(); await p.waitForSelector('[role=dialog] >> text=How often, by season'); await p.waitForSelector('[role=dialog] >> text=New price starts on') } },
      { name: 'new-plan', run: async (p) => { await p.getByRole('button', { name: '+ Add plan' }).click(); await p.waitForSelector('[role=dialog] >> text=Plan type'); await p.getByRole('button', { name: 'Change', exact: true }).waitFor() } },
      { name: 'new-plan-details', run: async (p) => { await p.getByRole('button', { name: '+ Add plan' }).click(); await p.getByRole('button', { name: 'Change', exact: true }).click(); await p.waitForSelector('[role=dialog] >> text=How often, by season') } },
      { name: 'pause', run: async (p) => { await p.getByRole('button', { name: 'Pause' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Resume on (optional)') } },
      { name: 'preview', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).first().click(); await p.getByRole('button', { name: 'Next: see what changes' }).click(); await p.waitForSelector('[role=dialog] >> text=What will change') } },
      { name: 'history', run: async (p) => { await p.getByRole('button', { name: 'History' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Price: 45 → 55') } },
    ] },
  { name: 'visits-board', path: '/dev-harness/visits-board', ready: 'text=Gate code 4421. Dog in back yard. >> nth=0', mock: async (p) => {
    await p.route(/\/api\/ops\/visits(\?.*)?$/, (route) => route.fulfill(json(HARNESS_VISITS)))
    await p.route('**/api/ops/visits/*/photos', (route) => route.fulfill(json({ photos: [{ id: 'ph1', filename: 'front.jpg', created_at: '2026-11-10T15:00:00Z' }] })))
    await p.route(/\/api\/service-plans$/, (route) => route.fulfill(json({ ...HARNESS_SERVICE_PLANS, properties: [] })))
    await p.route('**/api/ops/subs/*/crew-day-link', (route) => route.fulfill(json({ path: '/crew/day/tok123' })))
  },
    states: [
      { name: 'skip-sheet', run: async (p) => { await p.getByRole('button', { name: 'Skip' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Why?') } },
      { name: 'step-result', run: async (p) => { await p.getByRole('button', { name: 'Done', exact: true }).nth(1).click(); await p.waitForSelector('[role=dialog] >> text=How did it go?') } },
      { name: 'bulk-move', run: async (p) => { await p.getByRole('button', { name: 'Rain day — move visits' }).click(); await p.waitForSelector('[role=dialog] >> text=Move them to'); await p.getByRole('button', { name: 'Pick a day' }).click(); await p.waitForSelector('[role=dialog] >> text=New day for the first one') } },
      { name: 'crew-links', run: async (p) => { await p.getByRole('button', { name: 'Crew phone links' }).click(); await p.getByRole('button', { name: 'Make link' }).first().click(); await p.getByRole('button', { name: 'Copy' }).waitFor() } },
      { name: 'more', run: async (p) => { await p.getByRole('button', { name: 'More', exact: true }).first().click(); await p.waitForSelector('text=Add photos (drop or tap)') } },
      { name: 'new-customer', run: async (p) => { await p.getByRole('button', { name: '+ New customer + plan' }).click(); await p.waitForSelector('[role=dialog] >> text=Customer name *') } },
    ] },
  { name: 'ready-to-bill', path: '/dev-harness/ready-to-bill', ready: 'text=Pat Lee', mock: async (p) => {
    await p.route(/\/api\/ops\/billing(\?.*)?$/, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(json({ created: [{ key: 'c:c1:2026-10', invoiceId: 'i1', invoiceNumber: 'INV-26-00016', customerName: 'Pat Lee', totalCents: 19700, sent: true, sendError: null }, { key: 'c:c2:2026-10', invoiceId: 'i2', invoiceNumber: 'INV-26-00017', customerName: 'Sam Ortiz', totalCents: 4000, sent: false, sendError: 'No email on file — left as a draft' }], alreadyBilled: [], failed: [] }))
        : route.fulfill(json(HARNESS_READY_TO_BILL)))
  },
    states: [
      { name: 'lines', run: async (p) => { await p.getByRole('button', { name: /Pat Lee/ }).click(); await p.waitForSelector('text=Sales tax') } },
      { name: 'per-visit', run: async (p) => { await p.getByRole('button', { name: 'One per visit' }).click(); await p.waitForSelector('text=5 invoices') } },
      { name: 'confirm', run: async (p) => { await p.getByRole('button', { name: /^Bill 2/ }).click(); await p.waitForSelector('[role=dialog] >> text=1 without an email stay as drafts.') } },
      { name: 'billed', run: async (p) => { await p.getByRole('button', { name: /^Bill 2/ }).click(); await p.getByRole('button', { name: 'Make and email' }).click(); await p.waitForSelector('text=Made 2 invoices · 1 emailed') } },
    ] },
  { name: 'hours-to-bill', path: '/dev-harness/hours-to-bill', ready: 'text=Pat Lee', mock: async (p) => {
    await p.route(/\/api\/ops\/hours-to-bill(\?.*)?$/, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill(json({ ok: true, invoiceId: 'i9', invoiceNumber: 'INV-26-26-0141-002', totalCents: 140000, isJobInvoice: true, sent: false, sendError: null }))
        : route.fulfill(json(HARNESS_HOURS_TO_BILL)))
    await p.route('**/api/ops/hours-to-bill/*', (route) => route.fulfill(json({ ok: true })))
  },
    states: [
      { name: 'day-sheet', run: async (p) => { await p.getByRole('button', { name: /Tue, Nov 3, 2026/ }).click(); await p.waitForSelector('[role=dialog] >> text=From the clock') } },
      { name: 'edit-needs-reason', run: async (p) => { await p.getByRole('button', { name: /Tue, Nov 3, 2026/ }).click(); await p.getByLabel('Hours each').fill('5'); await p.waitForSelector('[role=dialog] >> text=Why did the hours change?') } },
      { name: 'typed-visit', run: async (p) => { await p.getByRole('button', { name: /No clock time/ }).click(); await p.waitForSelector('[role=dialog] >> text=Typed — no clock time') } },
      { name: 'type-a-day', run: async (p) => { await p.getByRole('button', { name: 'Type hours for a day' }).click(); await p.waitForSelector('[role=dialog] >> text=Day worked') } },
      { name: 'billed', run: async (p) => { await p.getByRole('button', { name: /^Bill 2 days/ }).click(); await p.waitForSelector('text=INV-26-26-0141-002') } },
      { name: 'unapprove', run: async (p) => { await p.getByText('Billed (1)').click(); await p.getByRole('button', { name: 'Un-approve to bill again' }).click(); await p.waitForSelector('[role=dialog] >> text=Un-approve these hours?') } },
    ] },
  { name: 'job-hourly', path: '/dev-harness/job-hourly', ready: 'text=Billing', mock: async (p) => {
    await p.route('**/api/ops/jobs/*/hourly', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill(json({ ...HARNESS_JOB_HOURLY, mode: 'time_materials', estimatedHours: 20, rateItemId: 'pb-labor', ok: true }))
        : route.fulfill(json(HARNESS_JOB_HOURLY)))
  },
    states: [
      { name: 'by-the-hour', run: async (p) => { await p.getByRole('button', { name: 'By the hour' }).click(); await p.waitForSelector('text=of 20 h estimated') } },
    ] },
  { name: 'hourly-settings', path: '/dev-harness/hourly-settings', ready: 'text=Hourly billing', mock: async (p) => {
    await p.route('**/api/admin/hourly-billing', (route) => route.fulfill(json({ ok: true, ...HARNESS_HOURLY_SETTINGS })))
  } },
  { name: 'customer-invoices', path: '/dev-harness/customer-invoices', ready: 'text=INV-26-00012', mock: async (p) => {
    await p.route('**/api/customers/*/invoices', (route) => route.fulfill(json(HARNESS_CUSTOMER_INVOICES)))
    await p.route('**/api/customers/*/card', (route) => route.fulfill(json({ available: true, featureOn: true, card: { label: 'Visa •••• 4242', autopay: true, expired: false, expires: '12/30' } })))
    await p.route('**/api/invoices/*', (route) => route.fulfill(json({ success: true, invoice: { ...HARNESS_CUSTOMER_INVOICES.invoices[0], items: [], payments: [] } })))
  },
    states: [
      { name: 'mark-paid', run: async (p) => { await p.getByRole('button', { name: 'Mark paid' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Amount paid') } },
    ] },
  { name: 'crew-day', path: '/dev-harness/crew-day', ready: 'text=Gate code 4421. Dog in back yard.',
    mock: async (p) => {
      await p.route('**/api/crew/day/*/status', (route) => route.fulfill(json({ active: true })))
      await p.route('**/api/crew/day/*/visits/*', (route) => route.fulfill(json({ ok: true })))
    },
    states: [
      { name: 'skip-undo', run: async (p) => { await p.getByRole('button', { name: 'Skip', exact: true }).first().click(); await p.getByRole('button', { name: 'Rain / weather' }).click(); await p.getByRole('button', { name: 'Undo' }).waitFor() } },
      { name: 'done-photo', run: async (p) => { await p.getByRole('button', { name: 'Done', exact: true }).first().click(); await p.waitForSelector('text=Done. Add a photo?') } },
      { name: 'skip-reasons', run: async (p) => { await p.getByRole('button', { name: 'Skip', exact: true }).first().click(); await p.waitForSelector('text=Why skip?') } },
      { name: 'step-results', run: async (p) => { await p.getByRole('button', { name: 'Done', exact: true }).nth(1).click(); await p.waitForSelector('text=Needs a return trip') } },
    ] },
  { name: 'crew-day-on-the-way', path: '/dev-harness/crew-day-on-the-way', ready: 'text=Gate code 4421. Dog in back yard.',
    mock: async (p) => {
      await p.route('**/api/crew/day/*/status', (route) => route.fulfill(json({ active: true })))
      await p.route('**/api/crew/day/*/visits/*/on-the-way', (route) => route.fulfill(json({ ok: true, status: 'sent', message: 'Customer told you’re on the way' })))
    },
    states: [
      { name: 'told', run: async (p) => { await p.getByRole('button', { name: 'On my way' }).first().click(); await p.waitForSelector('text=Customer told you’re on the way') } },
    ] },
  { name: 'customer-messages-settings', path: '/dev-harness/customer-messages-settings', ready: 'text=Visit reminder',
    mock: async (p) => {
      await p.route('**/api/admin/customer-messages', (route) => route.fulfill(json({ ok: true })))
    },
    states: [
      { name: 'preview', run: async (p) => { await p.getByRole('button', { name: 'See the email' }).first().click(); await p.waitForSelector('[role=dialog] >> text=Subject:') } },
      { name: 'timing-dirty', run: async (p) => { await p.getByPlaceholder('between 8 AM and 5 PM').fill('8 to 5'); await p.waitForSelector('text=Save changes') } },
    ] },
  { name: 'customer-messages-card', path: '/dev-harness/customer-messages-card', ready: 'text=Automatic emails' },
  { name: 'crew-day-clock', path: '/dev-harness/crew-day-clock', ready: 'text=Crew time',
    mock: async (p) => {
      await p.route('**/api/crew/day/*/status', (route) => route.fulfill(json({ active: true })))
      // Stateful like the server: after a clock-in tap the re-read shows the crew clocked in at stop 1.
      let clockedIn = false
      await p.route('**/api/crew/day/*/clock', (route) => {
        if (route.request().method() !== 'GET') { clockedIn = true; return route.fulfill(json({ ok: true, done: 3 })) }
        return route.fulfill(json(clockedIn ? HARNESS_CLOCK_STATE_IN : HARNESS_CLOCK_STATE))
      })
    },
    states: [
      { name: 'untick-absent', run: async (p) => { await p.getByRole('button', { name: /Tony Crew/ }).click(); await p.waitForSelector('text=Clock in crew here (2)') } },
      { name: 'clocked-in', run: async (p) => { await p.getByRole('button', { name: /Clock in crew here/ }).first().click(); await p.waitForSelector('text=Clocked in here') } },
      { name: 'finish-question', run: async (p) => { await p.waitForSelector('text=What time did Dee Crew finish') } },
    ] },
  { name: 'crew-day-clocked-in', path: '/dev-harness/crew-day-clocked-in', ready: 'text=Compact tractor',
    mock: async (p) => {
      await p.route('**/api/crew/day/*/status', (route) => route.fulfill(json({ active: true })))
      await p.route('**/api/crew/day/*/clock', (route) => route.fulfill(route.request().method() === 'GET' ? json(HARNESS_CLOCK_STATE_IN) : json({ ok: true, done: 3 })))
      await p.route('**/api/crew/day/*/visits/*', (route) => route.fulfill(json({ ok: true })))
    },
    states: [
      { name: 'move-crew', run: async (p) => { await p.getByRole('button', { name: 'Move crew here' }).first().click(); await p.waitForSelector('text=Move the crew to this stop?') } },
      { name: 'done-clock-out', run: async (p) => { await p.getByRole('button', { name: 'Done', exact: true }).first().click(); await p.waitForSelector('text=Driving to the next stop') } },
      { name: 'clock-out', run: async (p) => { await p.getByRole('button', { name: 'Clock out crew' }).click(); await p.waitForSelector('text=Yes — done for the day') } },
    ] },
  { name: 'job-clock', path: '/dev-harness/job-clock', ready: 'text=My time',
    // Stateful like the server: after the tap, the re-read shows the person clocked in on this job.
    mock: async (p) => {
      let clockedIn = false
      await p.route('**/api/time/clock', (route) => {
        if (route.request().method() !== 'GET') { clockedIn = true; return route.fulfill(json({ ok: true, done: 1 })) }
        const st = clockedIn ? { ...HARNESS_JOB_CLOCK_SELF, people: HARNESS_JOB_CLOCK_SELF.people.map((x) => ({ ...x, open: { entryId: 'bbbbbbbb-0000-4000-8000-000000000099', workOrderId: null, jobId: 'dddddddd-0000-4000-8000-000000000001', startedAt: '2026-11-10T12:00:00.000Z' } })) } : HARNESS_JOB_CLOCK_SELF
        return route.fulfill(json(st))
      })
    },
    states: [{ name: 'clocked-in', run: async (p) => { await p.getByRole('button', { name: 'Clock in', exact: true }).click(); await p.waitForSelector('text=Clocked in here') } }] },
  { name: 'time-week', path: '/dev-harness/time-week', ready: 'text=Dee Crew',
    mock: async (p) => {
      await p.route('**/api/admin/time/settings', (route) => route.fulfill(json({ settings: { autoCloseHours: 12, captureLocation: false, overtimeAfterHours: 40, breakWarningAfterHours: 6 } })))
      await p.route(/\/api\/admin\/time\/[0-9a-f-]{36}$/, (route) => route.fulfill(json({ history: [{ action: 'auto_closed', by: 'System', at: '2026-11-10T10:30:00.000Z', reason: null, changes: [{ field: 'ended_at', label: 'End', old: null, new: '2026-11-09T17:30:00.000Z' }] }] })))
    },
    states: [
      { name: 'edit-sheet', run: async (p) => { await p.getByRole('button', { name: /Forgot to clock out/ }).first().click(); await p.waitForSelector('[role=dialog] >> text=Why? (required)') } },
      { name: 'add-sheet', run: async (p) => { await p.getByRole('button', { name: '+ Add time', exact: true }).click(); await p.waitForSelector('[role=dialog] >> text=Why? (required)') } },
    ] },
  { name: 'crew-time-setup', path: '/dev-harness/crew-time-setup', ready: 'text=Crew lead ✓',
    mock: async (p) => { await p.route('**/api/admin/subs/*/crew', (route) => route.fulfill(json(HARNESS_CREW_SETUP))) } },
  { name: 'plan-templates', path: '/dev-harness/plan-templates', ready: 'text=Roof & gutter care', mock: async (p) => {
    await p.route('**/api/admin/service-plan-templates', (route) => route.fulfill(json(HARNESS_PLAN_TEMPLATES)))
    await p.route('**/api/admin/service-plan-templates/*', (route) => route.fulfill(json(HARNESS_TEMPLATE_DETAIL)))
    await p.route('**/api/admin/service-plan-templates/*/apply', (route) => route.fulfill(json({ ok: true, plans: 4, effect: { removed: 8, added: 8, updated: 4 }, needsPriceCheck: [], summary: '4 plans: 8 upcoming visits removed, 8 added, 4 updated.' })))
  },
    states: [
      { name: 'editor', run: async (p) => { await p.getByRole('button', { name: 'Edit' }).nth(1).click(); await p.waitForSelector('[role=dialog] >> text=After each visit') } },
      { name: 'push-preview', run: async (p) => { await p.getByRole('button', { name: 'Plans & history' }).first().click(); await p.waitForSelector('text=New prices start on (optional)'); await p.getByRole('button', { name: /Update plans/ }).click(); await p.waitForSelector('text=4 plans: 8 upcoming visits removed') } },
    ] },
  { name: 'settings-hub', path: '/dev-harness/settings-hub', ready: 'text=People & access',
    states: [{ name: 'searching', run: async (p) => { await p.getByRole('searchbox').fill('commission'); await p.waitForTimeout(200) } }] },
  { name: 'today-queues', path: '/dev-harness/today', ready: 'text=Proposals waiting for a signature' },
  { name: 'ui-kit', path: '/dev-harness/ui-kit', ready: 'text=Pay this week',
    states: [{ name: 'sheet-open', run: async (p) => { await p.getByRole('button', { name: 'Open sheet' }).click(); await p.waitForSelector('text=Save this view') } }] },
  { name: 'default-plans-card', path: '/dev-harness/default-plans', ready: 'text=Default pay plan by role' },
  { name: 'my-pay', path: '/dev-harness/my-pay', ready: 'text=My pay',
    states: [
      { name: 'line-open', run: async (p) => { await p.getByRole('button', { name: /26-0141/ }).click(); await p.waitForSelector("text=Something's wrong?") } },
      { name: 'ask', run: async (p) => { await p.getByRole('button', { name: /26-0141/ }).click(); await p.getByRole('button', { name: "Something's wrong?" }).click(); await p.waitForSelector('text=Send to the office') } },
    ] },
  { name: 'customer-file', path: '/dev-harness/customer-file', ready: 'text=Ashley Gaines',
    states: [
      { name: 'notes-loaded', run: async (p) => { await p.waitForSelector('text=Materials ordered') } },
      { name: 'pricing-guard', run: async (p) => { await p.getByLabel('Message').fill('Signed at $18,400 today'); await p.waitForSelector("text=Looks like pricing") } },
      { name: 'mention-picker', run: async (p) => { await p.getByLabel('Message').fill('@Ril'); await p.waitForSelector('text=Riley Ops') } },
    ] },
  { name: 'list-work-orders', path: '/dev-harness/work-orders', ready: 'text=WO-0015 >> visible=true',
    states: [{ name: 'done-view', run: async (p) => { await expect(async () => { await p.getByLabel('Saved views').selectOption({ label: 'Done' }); await expect(p.getByText('WO-0012', { exact: true }).locator('visible=true').first()).toBeVisible({ timeout: 2_000 }) }).toPass({ timeout: 30_000 }) } }] },
  { name: 'list-customers', path: '/dev-harness/customers', ready: 'text=Ashley Gaines >> visible=true',
    states: [{ name: 'prospects', run: async (p) => { await p.getByLabel('Saved views').selectOption({ label: 'Prospects (not sold yet)' }); await p.waitForSelector('text=Dana Whitfield >> visible=true') } }] },
  { name: 'list-proposals', path: '/dev-harness/proposals', ready: 'text=P-00121 >> visible=true' },
  { name: 'list-leads', path: '/dev-harness/leads', ready: 'text=Ashley Gaines >> visible=true' },
  { name: 'list-job-profit', path: '/dev-harness/job-profit', ready: 'text=Gaines >> visible=true',
    states: [{ name: 'low-margin', run: async (p) => { await p.getByLabel('Saved views').selectOption({ label: 'Low margin (under 20%)' }); await p.waitForSelector('text=Cox >> visible=true') } }] },
  { name: 'list-appointments', path: '/dev-harness/appointments', ready: 'text=Ashley Gaines >> visible=true',
    states: [{ name: 'needs-feedback', run: async (p) => { await p.getByLabel('Saved views').selectOption({ label: 'Needs feedback' }); await p.waitForSelector('text=Bill Cox >> visible=true') } }, { name: 'reassign', run: async (p) => { await p.getByRole('button', { name: 'Reassign' }).first().click(); await p.waitForSelector('text=Reassign appointment') } }] },
  { name: 'list-opportunities', path: '/dev-harness/opportunities', ready: 'text=Bill Cox >> visible=true' },
  ...(['ops', 'owner'] as const).map((who): Screen => ({
    name: `job-v2-${who}`, path: `/dev-harness/job-v2-${who}`, ready: '[role=tablist]', mock: mockJob0037,
    states: [
      { name: 'materials', run: async (p) => { await p.getByRole('tab', { name: 'Materials' }).click(); await p.waitForSelector('#materials-section') } },
      { name: 'money', run: async (p) => { await p.getByRole('tab', { name: 'Money' }).click(); await p.waitForSelector('[data-testid=money-head]') } },
      { name: 'files', run: async (p) => { await p.getByRole('tab', { name: 'Files' }).click(); await p.waitForSelector('#job-files-section') } },
      { name: 'run-sheet-email', run: async (p) => { await p.getByRole('tab', { name: 'Crews' }).click(); await p.getByRole('button', { name: 'Email' }).click(); await p.waitForSelector('text=Send the run sheet to') } },
    ],
  })),
  { name: 'catch-up-board', path: '/dev-harness/catch-up-board', ready: 'text=No owner · Order materials · 9d >> visible=true',
    states: [
      { name: 'board-view', run: async (p) => { await p.getByRole('button', { name: 'Board', exact: true }).click(); await p.waitForSelector('[data-stuck=true] >> visible=true') } },
      { name: 'stuck-view', run: async (p) => { await p.getByLabel('Saved views').selectOption({ label: 'Stuck' }); await p.waitForSelector('text=No owner · Order materials · 9d >> visible=true') } },
      { name: 'my-jobs-view', run: async (p) => {
        await p.getByLabel('Saved views').selectOption({ label: 'My jobs' })
        await p.waitForSelector('text=Dana · Roofing crew Nov 12 · today >> visible=true')
        if (await p.locator('text=No owner · Order materials · 9d >> visible=true').count()) throw new Error('My jobs shows a job owned by nobody')
      } },
      { name: 'no-owner-view', run: async (p) => {
        await p.getByLabel('Saved views').selectOption({ label: 'No owner' })
        await p.waitForSelector('[data-testid=catch-up-no-owner] >> visible=true')
        if (await p.locator('text=Dana · Roofing crew Nov 12 · today >> visible=true').count()) throw new Error('No owner view shows an owned job')
      } },
    ] },
  { name: 'catch-up-job', path: '/dev-harness/catch-up-job', ready: 'text=Where this stands',
    mock: async (p) => { await p.route('**/api/ops/jobs/*/owner', (route) => route.fulfill(json(HARNESS_OWNER_CANDIDATES))) },
    states: [
      { name: 'no-owner-banner', run: async (p) => {
        await p.waitForSelector('[data-testid=no-owner-banner] >> visible=true')
        await p.locator('[data-testid=no-owner-banner] select option', { hasText: 'Dana Example' }).waitFor({ state: 'attached' })
      } },
      { name: 'owner-picker-in-box', run: async (p) => { await p.locator('[data-testid=catch-up-box] [data-testid=catch-up-owner]').click(); await p.locator('[data-testid=catch-up-box] select option', { hasText: 'Dana Example' }).waitFor({ state: 'attached' }) } },
    ] },
  { name: 'catch-up-job-v2', path: '/dev-harness/catch-up-job-v2', ready: 'text=Where this stands', mock: mockJob0037 },
  { name: 'catch-up-settings', path: '/dev-harness/catch-up-settings', ready: 'text=Flag a job as stuck' },
  { name: 'org-features', path: '/dev-harness/org-features', ready: 'text=Turn off what your company doesn’t use' },
  { name: 'org-profile', path: '/dev-harness/org-profile', ready: 'text=A profile sets the starting point',
    mock: async (p) => {
      await p.route('**/api/admin/industry-profile**', (route) => route.fulfill(json({ plan: {
        from: { id: 'roofing', label: 'Roofing' },
        to: { id: 'lawn_landscape', label: 'Lawn & landscape', version: 1, description: 'Recurring lawn maintenance' },
        resetFeatures: false,
        features: [{ key: 'canvassing', label: 'Door knocking (Canvass app)', now: true, after: false, keptByOwnSwitch: false }],
        trades: { add: ['Lawn care', 'Landscaping', 'Tractor / land work', 'Clean-up', 'Soft wash / pressure washing'], turnOn: [], keep: ['Roofing', 'Gutters', 'Siding', 'Windows', 'Other'] },
        words: [{ key: 'proposal', now: 'Proposal', after: 'Quote' }, { key: 'inspection', now: 'Inspection', after: 'Estimate visit' }],
        other: ['Menu order: Today · Work · Customers · Pipeline · Money · Insights', 'Price book units: Per visit, Per month, Per sq ft, Per hour, Each, Per job'],
        noChange: false,
      } })))
    },
    states: [{ name: 'preview', run: async (p) => { await p.getByLabel('Switch to').selectOption('lawn_landscape'); await p.waitForSelector('text=What changes with Lawn & landscape') } }] },
  { name: 'sales-tax', path: '/dev-harness/sales-tax', ready: 'text=Rates stack' },
  { name: 'pay-page', path: '/dev-harness/pay-page', ready: 'text=Amount due',
    states: [
      { name: 'part-and-save', run: async (p) => { await p.getByRole('button', { name: 'Pay a different amount' }).click(); await p.getByLabel('Amount to pay now').fill('40'); await p.getByLabel(/Save my card/).check(); await p.waitForSelector('text=I authorize') } },
    ] },
  { name: 'pay-page-paid', path: '/dev-harness/pay-page-paid', ready: 'text=Paid — thank you!' },
  { name: 'save-card-page', path: '/dev-harness/save-card-page', ready: 'text=Agree and add card' },
  { name: 'online-payments-settings', path: '/dev-harness/online-payments-settings', ready: 'text=Connected — taking payments', mock: async (p) => {
    await p.route('**/api/admin/online-payments', (route) => route.fulfill(json({ featureOn: true, configured: true, ready: true, testMode: true, settings: { allowPartial: false, bankPayments: true, autopay: true, retryDays: [3, 7] }, account: { status: 'active', chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: true, livemode: false, accountId: 'acct_1' } })))
  } },
  { name: 'invoice-online', path: '/dev-harness/invoice-online', ready: 'text=Copy pay link' },
  { name: 'tax-exemption', path: '/dev-harness/tax-exemption', ready: 'text=Tax exempt (no sales tax' },
  { name: 'admin-settings', path: '/dev-harness/admin-settings', ready: 'text=Customer-facing brand',
    states: [{ name: 'editing-brand', run: async (p) => { await p.getByLabel('Website').fill('example.test/roofing'); await p.waitForTimeout(200) } }] },
  { name: 'admin-settings-readonly', path: '/dev-harness/admin-settings-readonly', ready: 'text=Only an owner can change these' },
  { name: 'moved-host-pending', path: '/dev-harness/moved-host-pending', ready: 'text=Try again' },
  { name: 'moved-host-attention', path: '/dev-harness/moved-host-attention', ready: 'text=Continue anyway to crm.example.test' },
  { name: 'moved-host-ready', path: '/dev-harness/moved-host-ready', ready: 'text=Tap to continue at crm.example.test' },
  { name: 'pay-week', path: '/dev-harness/pay-week', ready: 'text=Needs you (4)',
    states: [
      { name: 'person-open', run: async (p) => { await p.getByRole('button', { name: /Jordan Vale/ }).click(); await p.waitForSelector('text=Change') } },
      { name: 'by-job', run: async (p) => { await p.getByRole('tab', { name: /By job/ }).click(); await p.waitForSelector('text=Job 26-0141') } },
      { name: 'fix-sheet', run: async (p) => { await p.getByRole('button', { name: 'Fix a mistake' }).click(); await p.waitForSelector('text=Amount (+ pays them') } },
      { name: 'approve-sheet', run: async (p) => { await p.getByRole('button', { name: /^Approve/ }).click(); await p.waitForSelector('text=Email each person their statement') } },
      { name: 'blocked-by-minimum', run: async (p) => { await p.route('**/api/admin/payroll/pay-week', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...PAY_WEEK, canApprove: false, blockedBy: { code: 'minimum_unanswered', text: 'Answer the weekly minimum for 1 person first.', count: 1 } }) })); await p.reload(); await p.waitForSelector('text=Answer the weekly minimum for 1 person first.') } },
      { name: 'change-sheet', run: async (p) => { await p.getByRole('tab', { name: /By job/ }).click(); await p.getByRole('button', { name: 'Change who gets what' }).first().click(); await p.waitForSelector('text=Total 18% of the base'); await p.getByRole('button', { name: '+ Add someone' }).click() } },
      { name: 'preview-pay-sheets-button', run: async (p) => { await p.getByRole('link', { name: 'Preview pay sheets' }).scrollIntoViewIfNeeded(); await p.waitForSelector('text=Preview pay sheets') } },
      { name: 'advances', run: async (p) => { await p.waitForSelector('text=$400 still owed'); await p.getByRole('button', { name: 'Record an advance' }).click(); await p.waitForSelector('text=Take it back') } },
      { name: 'schedule-sheet', run: async (p) => { await p.getByRole('button', { name: 'Change', exact: true }).first().click(); await p.getByLabel('Week starts on').selectOption('1'); await p.waitForSelector('text=First week on it') } },
    ] },
]

/** Interactive elements a thumb has to hit. Inline text links inside a sentence are exempt. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = []
    const els = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button]'))
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue
      if (el.tagName === 'A' && el.closest('p, li > span, td')) continue
      if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) continue
      if (r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || (el as HTMLInputElement).placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    return out
  })
}

async function smallInputText(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea'))
      .filter((el) => el.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('name') || el.getAttribute('placeholder') || el.getAttribute('type') || ''} ${getComputedStyle(el).fontSize}`)
  )
}

for (const screen of SCREENS) {
  test.describe(screen.name, () => {
    const variants = [{ name: 'default', run: async () => {} }, ...(screen.states ?? [])]
    for (const v of variants) {
      test(`${screen.name} / ${v.name}`, async ({ page }, info) => {
        await mockApi(page)
        await screen.mock?.(page)
        await page.goto(screen.path)
        await page.waitForSelector(screen.ready, { timeout: 30_000 })
        await v.run(page)
        await page.waitForTimeout(300)

        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, inner: window.innerWidth }))
        await page.screenshot({ path: `e2e/screenshots/${info.project.name}-${screen.name}-${v.name}.png`, fullPage: true })
        if (widths.scroll > widths.inner) {
          const culprits = await page.evaluate(() => {
            const vw = document.documentElement.clientWidth
            const out: string[] = []
            document.querySelectorAll('body *').forEach((el) => {
              const r = (el as HTMLElement).getBoundingClientRect()
              if (r.right <= vw + 1 || r.width === 0) return
              let p = el.parentElement
              while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return; p = p.parentElement }
              out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(r.right)}`)
            })
            return out.slice(0, 6)
          })
          console.log(`OVERFLOW ${info.project.name} ${screen.name}/${v.name}:\n  ${culprits.join('\n  ')}`)
        }
        const small = await smallTargets(page)
        const smallText = await smallInputText(page)
        if (process.env.REPORT) {
          console.log(`REPORT ${info.project.name} ${screen.name}/${v.name} scroll=${widths.scroll}/${widths.inner} small=${small.length} text=${smallText.length}\n  ${Array.from(new Set([...small.slice(0, 12), ...smallText.slice(0, 6)])).join('\n  ')}`)
          return
        }
        expect(widths.scroll, `page scrolls sideways: scrollWidth ${widths.scroll} > viewport ${widths.inner}`).toBeLessThanOrEqual(widths.inner)
        expect(small, `tap targets under 44px:\n${small.join('\n')}`).toEqual([])
        expect(smallText, `inputs under 16px (iOS zooms on focus):\n${smallText.join('\n')}`).toEqual([])
      })
    }
  })
}
