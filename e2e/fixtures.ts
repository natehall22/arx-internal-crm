import type { DataHealthReport } from '../lib/data-health'

const problem = (code: string, area: string, message: string, fixLabel: string) => ({
  code, area, message, fixLabel, fixHref: '/ops/jobs/job-1', blocksPay: area === 'money' || area === 'credit',
})

export const HARNESS_NEEDS_YOU = {
  generatedAt: '2026-10-22T12:00:00Z',
  count: 5,
  endedPlans: [{ id: 'e1', name: 'Nathan Hall', role: 'admin', roleLabel: 'Admin', endedOn: '2026-08-19' }],
  payPlans: [
    { role: 'sales_rep', roleLabel: 'Closer', people: [{ id: 'r1', name: 'Cam Hill' }, { id: 'r2', name: 'Tim Joyce' }, { id: 'r3', name: 'Travis Nelson' }], suggestion: { id: 'plan-closer', name: 'Closer', ratePercent: 7 } },
  ],
  jobs: [
    {
      kind: 'job', jobId: 'job-1', jobNumber: '26-0042', status: 'complete', addressText: '12 Elm Street, Concord NC 28025',
      problems: [
        problem('collected_but_short', 'money', 'Collected $12,400.00 but the sale amount is $16,325.00 — $3,925.00 still owed.', 'Open payments'),
        problem('no_setter', 'credit', 'No setter on the deal, so nobody gets setter credit.', 'Fix credit'),
      ],
    },
    {
      kind: 'job', jobId: 'job-2', jobNumber: '26-0043', status: 'in_progress', addressText: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117',
      problems: [problem('materials_not_ordered', 'ops', 'Install is in 3 days and materials are not marked ordered.', 'Mark ordered')],
    },
  ],
  appointments: [
    { kind: 'appointment', appointmentId: 'a1', scheduledFor: '2026-10-20T15:00:00Z', appointmentType: 'inspection', addressText: '88 Oak Ln, Kannapolis NC', problems: [problem('appointment_no_outcome', 'sales', 'Past inspection with no outcome logged.', 'Log outcome')] },
  ],
} as unknown as DataHealthReport

const cardBase = { orderStatus: null, lastSentAt: null, lastSentTo: null, canCancel: false, blockers: [] as string[] }

export const SUPPLIER_VIEW = {
  jobNumber: '26-0042', jobCancelled: false, canSend: true,
  rollup: { parts: [], covered: 1, total: 2, allCovered: false, summary: '1 of 2 suppliers ordered' },
  blockers: [], warnings: ['The gutter installer now supplies their own materials — check the PO.'],
  cards: [
    { ...cardBase, vendorId: 'v1', supplierName: 'ABC Supply', state: 'not_sent', poNumber: 'PO-26-0042-A',
      lines: [
        { key: 'shingles', label: 'Field shingles — Owens Corning Duration Driftwood', qty: '58 bundles', trade: 'roofing' },
        { key: 'ridge', label: 'Hip & ridge cap', qty: '6 bundles', trade: 'roofing' },
        { key: 'panel', label: 'Gutter downspout 2x3 white', qty: '12 pcs', trade: 'gutters' },
      ] },
    { ...cardBase, vendorId: 'v2', supplierName: 'City Electric Supply', state: 'sent', orderStatus: 'sent', poNumber: 'PO-26-0042-B', lastSentAt: '2026-10-21T14:00:00Z', lastSentTo: 'orders@cityelectric.test', canCancel: true,
      lines: [{ key: 'panel2', label: 'Roof-mounted disconnect', qty: '1', trade: 'electrical' }] },
  ],
  nonPo: [{ label: 'Gutters — supplied by installer (Sparky Gutters)', source: 'installer', trade: 'gutters', lines: [] }],
  unassigned: [], trades: [], lines: [], suppliers: [{ id: 'v1', name: 'ABC Supply' }, { id: 'v2', name: 'City Electric Supply' }],
  defaultDeliveryDate: '2026-11-02', defaultDeliveryAddress: '12 Elm Street, Concord NC 28025',
}

export const SUPPLIER_PREVIEW = {
  preview: {
    vendorId: 'v1', supplierName: 'ABC Supply', connectionType: 'email', kind: 'order', revision: 0, poNumber: 'PO-26-0042-A', poLabel: 'PO-26-0042-A',
    email: { to: 'orders@abcsupply-concord-branch-with-long-address.example.test', cc: ['ops@arxroofing.com'], subject: 'PO-26-0042-A — 12 Elm Street, Concord NC 28025 — deliver Nov 2' },
    deliveryDate: '2026-11-02', deliveryAddress: '12 Elm Street, Concord NC 28025', deliveryNotes: null, note: null,
    changes: [], notOnThisOrder: [], lines: [], linesHash: 'h', contentHash: 'c', confirmMessage: null, blockers: [],
    previewToken: 'tok', hasPdf: false, sendButtonLabel: 'Send to ABC Supply',
  },
  canSend: true,
}

export const COST_LINES = {
  costLines: [
    { id: 'c1', description: 'Shingles and underlayment (ABC Supply invoice 88213)', amount: 5421.03, cost_type: 'material', approved: true, vendors: { name: 'ABC Supply' } },
    { id: 'c2', description: 'Crew labor', amount: 2800, cost_type: 'labor', approved: false },
    { id: 'c3', description: 'Dumpster', amount: 450, cost_type: 'misc', approved: true },
  ],
  summary: { total: 8671.03, materials: 5421.03, labor: 2800, other: 450, lineCount: 3 },
}

export const TEMPLATE_META = (templates: unknown[]) => ({
  templates, canExport: true, finance: true, scope: 'all', role: 'admin',
  datasets: [{ key: 'sales', label: 'Sales', description: '', columns: [] }],
})

export const REPORT_RESULT = {
  spec: {},
  result: {
    columns: [{ key: 'group', label: 'Closer', type: 'text' }, { key: 'value', label: 'Total Sale amount', type: 'money' }, { key: 'rows', label: 'Rows', type: 'number' }],
    rows: [
      { group: 'Nathan Hall', value: 182340.12, rows: 11 },
      { group: 'Stevo Potts', value: 120211.5, rows: 8 },
      { group: 'A Very Long Closer Name Goes Here Jr.', value: 88000, rows: 5 },
    ],
    matched: 3, scanned: 24, truncated: false, summary: { label: 'Total Sale amount', value: 390551.62 },
  },
  canExport: true, finance: true,
}

export const SALE_CREDIT = {
  credit: { closerUserId: 'u1', setterUserId: 'u2', isSelfGenerated: false },
  locked: false, canEdit: true, isSuperAdmin: false,
}
export const USERS = { users: [{ id: 'u1', full_name: 'Nathan Hall' }, { id: 'u2', full_name: 'Stevo Potts' }, { id: 'u3', full_name: 'Alex Setter' }] }

export const SUPPLIERS = {
  suppliers: [
    { id: 'v1', name: 'ABC Supply', active: true, order_email: 'orders@abcsupply-concord-branch.example.test', order_cc_emails: [], account_number: '123', default_branch: 'Concord', default_delivery_notes: null, default_for_trades: ['roofing', 'gutters'], connection_type: 'email',
      last_order: { to: 'orders@abcsupply-concord-branch.example.test', at: '2026-10-21T14:00:00Z', po: 'PO-26-0042-A' },
      log: [{ at: '2026-10-20T12:00:00Z', by: 'Nathan Hall', action: 'updated', lines: ['Order email: (empty) → orders@abcsupply-concord-branch.example.test'] }] },
    { id: 'v2', name: 'QXO', active: false, order_email: null, order_cc_emails: [], account_number: null, default_branch: null, default_delivery_notes: null, default_for_trades: [], connection_type: 'email', last_order: null, log: [] },
  ],
}

export const HARNESS_CONTRACT = {
  id: 'c1', agreement_type: 'installation', customer_name: 'Pat Customer', customer_email: 'pat@example.test', customer_phone: '7045550100',
  project_address: '12 Elm Street, Concord NC 28025', project_cost: 16325, total_squares: 28, roofing_material: 'Owens Corning Duration — Driftwood',
  scope_roof_replacement: true, scope_roof_repair: false, scope_gutters: true, scope_siding: false, scope_other: null,
  payment_method: 'finance', finance_company: 'GoodLeap', deposit_amount: 1000, est_completion_date: '2026-11-20',
  exclusions: 'Interior repairs, chimney masonry.', additional_products: null, notes: null,
  rep_name: 'Nathan Hall', rep_title: 'Project Consultant', rep_signature_data: 'data:image/png;base64,iVBORw0KGgo=', rep_signed_at: '2026-10-20T15:00:00Z',
}

const job = (n: number, over: Record<string, unknown> = {}) => ({
  id: `job-${n}`, project_id: `p-${n}`, job_number: `26-00${40 + n}`, status: 'in_progress', job_type: 'roofing',
  address_text: `${100 + n} Long Street Name Boulevard, Mooresville NC 28117`, sale_amount: 16325 + n * 1000, sale_date: '2026-10-01',
  scheduled_date: '2026-11-0' + n, materials_status: 'ordered', permit_status: 'approved', priority: 'normal',
  customer: { id: `c${n}`, name: `Customer With A Long Name ${n}`, phone: '7045550100' }, salesperson: { id: 'u1', full_name: 'Nathan Hall' },
  assigned_sub: { id: 's1', company_name: 'Sparky Roofing LLC' }, collected_cents: 500000, job_costs: { total: 8000, materials: 5000, labor: 3000, other: 0, lineCount: 2 },
  project: { id: `p-${n}`, scope_of_work: 'Full replacement', product_summary: 'Duration Driftwood' }, ...over,
})
export const HARNESS_OPS_JOBS = [job(1), job(2, { status: 'sold', materials_status: 'not_ordered' }), job(3, { status: 'complete' }), job(4, { status: 'scheduled' })]

export const HARNESS_JOB = {
  id: 'job-1', org_id: 'org-1', project_id: 'p-1', job_number: '26-0042', status: 'complete', job_type: 'roofing',
  address_text: '12 Elm Street, Concord NC 28025', sale_amount: 16325, collected_cents: 1632500, deposit: 1000, deposit_required_percent: 0.1,
  finance_submitted_at: null, payroll_sent_at: null, sale_date: '2026-10-01', materials_status: 'ordered', materials_ordered_at: '2026-10-05T12:00:00Z',
  materials_eta: null, materials_notes: null, scheduled_date: '2026-10-12', scheduled_time_start: null, estimated_duration_hours: 8,
  permit_required: true, permit_status: 'approved', permit_number: 'BP-2026-1234', started_at: '2026-10-12T12:00:00Z', completed_at: '2026-10-13T20:00:00Z',
  completion_notes: null, priority: 'normal', internal_notes: null, allow_close_with_balance: false, close_balance_reason: null, close_balance_by: null,
  dealer_fee_amount: 0, dealer_fee_percent: null, final_front: true, final_back: true, final_left: true, final_right: true, final_slope_1: false, final_slope_2: false,
  flashing_detail: false, pipe_boots: false, before_photos: [], progress_photos: [], after_photos: [], created_at: '2026-10-01T12:00:00Z',
  opportunity_id: 'opp-1', special_instructions: null, job_source: 'retail',
  payroll_attribution: { opportunity_id: 'opp-1', setter_user_id: 'u2', closer_user_id: 'u1', setter_name: 'Stevo Potts', closer_name: 'Nathan Hall' },
  assigned_crew: null, assigned_sub: { id: 's1', company_name: 'Sparky Roofing LLC', contact_name: 'Sparky', phone: '7045550101' },
  customer: { id: 'c1', name: 'Pat Customer', phone: '7045550100', email: 'pat@example.test' }, salesperson: { id: 'u1', full_name: 'Nathan Hall' },
  project: { id: 'p-1', scope_of_work: 'Full roof replacement', product_summary: 'Duration Driftwood', ops_notes: null, permits_status: 'approved', install_date: '2026-10-12', payment_method: 'finance', sold_roof_squares: 28 },
  installation_agreement: null, roof_report: null, sold_scope: null,
}

const sheetField = (key: string, label: string, value: string | null, edited = false) => ({ key, label, source: 'Project review → scope, else project scope of work', computed: value, override: edited ? value : null, value, edited })
export const HARNESS_RUN_SHEET = {
  jobId: 'job-1', orgName: 'ARX Roofing & Exteriors', orgPhone: '7045550100', jobNumber: '26-0042', jobType: 'roofing', status: 'scheduled',
  address: '12 Elm Street, Concord NC 28025', scheduledDate: '2026-11-03', scheduledTimeStart: null, estimatedDurationHours: 8,
  permitRequired: true, permitNumber: 'BP-2026-1234', proposalNumber: 'P-00118',
  homeowner: { label: 'Homeowner', name: 'Pat Customer With A Long Name', phone: '7045550100' },
  runningJob: { label: 'Subcontractor', name: 'Sparky Roofing LLC', phone: '7045550101' },
  soldBy: { label: 'Sold by', name: 'Nathan Hall', phone: '7045550102' },
  measurements: [{ label: 'Squares', value: '28.5' }, { label: 'Ridge LF', value: '64' }, { label: 'Valley LF', value: '41' }, { label: 'Pitch', value: '6/12' }],
  fields: {
    schedule_note: sheetField('schedule_note', 'Schedule note', null),
    scope_of_work: sheetField('scope_of_work', 'Scope of work', 'Full tear-off and replacement of the main house roof, garage and covered porch. Replace all pipe boots and flashing.'),
    materials_and_products: sheetField('materials_and_products', 'Materials & products', 'Owens Corning Duration, Driftwood. Synthetic underlayment, ice & water at eaves and valleys.', true),
    tear_off_and_decking: sheetField('tear_off_and_decking', 'Tear-off, layers & decking', '1 layer. Replace rotten decking at $85/sheet.'),
    accessories: sheetField('accessories', 'Accessories', 'Ridge vent, 4 pipe boots, drip edge.'),
    add_ons_sold: sheetField('add_ons_sold', 'Add-ons sold', '306 LF seamless gutters, white.'),
    heads_up: sheetField('heads_up', 'Read before you start', 'HOA requires 8am start. Dog in backyard.'),
  },
  headsUp: [{ label: 'HOA', body: 'HOA requires 8am start.' }, { label: null, body: 'Dog in backyard — call before entering.' }],
  signedContracts: [{ id: 'k1', signedAt: '2026-10-01T12:00:00Z', agreementType: 'installation', pdfUrl: null, roofingMaterial: 'Duration', scopeOther: null, additionalProducts: null, exclusions: 'Interior repairs', notes: 'Deductible $1,500 paid at signing.' }],
  anyEdits: true, overridesUpdatedAt: '2026-10-20T12:00:00Z', generatedAt: '2026-10-21T12:00:00Z',
}

export const HARNESS_DASHBOARD = {
  profile: { id: 'u1', full_name: 'Nathan Hall', role: 'admin', org_id: 'org-1', email: 'nathan@example.test' },
  stats: { totalLeads: 120, newLeads: 14, totalOpportunities: 40, openOpportunities: 22, totalProjects: 18, activeProjects: 9, closeRate: 31, efficiency: 12, doorsKnockedThisWeek: 412, contactsThisWeek: 96, inspectionsSetThisWeek: 11, sitsThisWeek: 8, salesThisWeek: 3 },
  progress: { doors_knocked: { current: 412, goal: 500 }, contacts: { current: 96, goal: 120 }, inspections: { current: 11, goal: 12 }, sales: { current: 3, goal: 4 } },
}

export const BANNER = {
  announcement: {
    id: '11111111-1111-4111-8111-111111111111', title: "What's new",
    lines: ["Payroll is now one screen. Review 'Needs you', then press Approve.", 'Suppliers live in Settings → Suppliers: add ABC’s order email.', 'Reports: start from a template in Reports.'],
    link: '/whats-new',
  },
}
export const ANNOUNCEMENTS = {
  announcements: [{
    id: '11111111-1111-4111-8111-111111111111', slug: 'whats-new-2026-10', title: "What's new", link_url: '/whats-new', active: true,
    starts_at: '2026-10-22T12:00:00Z', ends_at: '2026-11-05T12:00:00Z',
    body: { owner: ['Payroll is now one screen.'], ops: ['Send material orders from the job’s order sheet.'] },
    dismissed: [{ name: 'Nathan Hall', at: '2026-10-23T12:00:00Z' }], not_dismissed: [{ name: 'Setter Sam' }],
  }],
}

export const DEFAULT_PLANS = {
  defaults: [{ id: 'd1', role: 'setter', roleLabel: 'Senior Field Marketer', planId: 'p5', planName: 'Setter', ratePercent: 5, effectiveFrom: '2026-10-24' }],
  plans: [
    { id: 'plan-closer', name: 'Closer', is_active: true, base_percentage: 7, applicable_roles: ['sales_rep'] },
    { id: 'p5', name: 'Setter', is_active: false, base_percentage: 5, applicable_roles: ['setter'] },
  ],
  gaps: [{ role: 'sales_rep', roleLabel: 'Closer', people: [{ id: 'r1', name: 'Cam Hill' }, { id: 'r2', name: 'Tim Joyce' }] }],
}

export const HARNESS_QUEUES = [
  { id: 'today-appointments', title: "Today's appointments", count: 2, empty: 'No more appointments today.', items: [
    { id: 'a1', title: '12 Elm Street, Concord NC 28025', detail: '3:30 PM', href: '#', ref: 'Appointment', note: '3:30 PM' },
    { id: 'a2', title: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117', detail: '5:00 PM', href: '#', ref: 'Appointment', note: '5:00 PM' },
  ] },
  { id: 'outcomes-to-log', title: 'Outcomes to log', count: 0, empty: 'Every past appointment has an outcome.', items: [] },
  { id: 'unsigned-proposals', title: 'Proposals waiting for a signature', count: 9, empty: 'Nothing waiting on a customer.', items: [
    { id: 'p1', title: 'Ashley Gaines', detail: '#P-00118 · $18,430.50', href: '#', ref: 'Proposal #P-00118', note: 'waiting since Oct 21' },
  ] },
]

/** Fictional week for the Pay-this-week screen (names, jobs and amounts are made up). */
export const PAY_WEEK = {
  canApprove: true, blockedBy: null, period: { id: '00000000-0000-4000-8000-000000000001', label: 'Week ending 2026-10-25', cutoffAt: '2026-10-26T03:59:59.999Z', payDate: '2026-10-30', status: 'open', weekStart: '2026-10-19', weekEnding: '2026-10-25' },
  schedule: { words: 'Monday–Sunday · closes Sunday 11:59 PM · paid Friday · money in by Wednesday 11:59 PM still pays that week' },
  viewer: { canApprove: true, canEditSchedule: true },
  advances: [{ id: 'adv1', userId: 'u-riley', name: 'Riley Moss', amount: 500, givenOn: '2026-10-12', note: 'truck repair', outstanding: 400, rule: '$100 a week', thisWeek: 100, belowMinimumOk: false, limited: false }],
  state: 'draft',
  totals: { amount: 5238.5, people: 5 },
  needs: [
    { kind: 'hours', userId: 'u-avery', name: 'Avery Lin', rate: 18 },
    { kind: 'bonus', id: 'b1', userId: 'u-riley', name: 'Riley Moss', amount: 250, what: 'Setter ramp bonus — 4 appointments set in first 30 days' },
    { kind: 'plans', text: '2 people have no pay plan, so they are paid nothing', names: ['Cam Hill', 'Tim Joyce'], href: '/admin/comp-plans' },
    { kind: 'minimum', userId: 'u-taylor', name: 'Taylor Finch', minimum: 500, commission: 180, topUp: 320 },
  ],
  warnings: [{ code: 'first_time', text: 'Taylor Finch is being paid for the first time.' }, { code: 'backlog', text: '2 jobs that finished before 2026-10-15 are included — nothing has paid them yet.' }],
  backlog: { jobs: 2, amount: 2170, since: '2026-10-15' },
  people: [
    { userId: 'u-jordan', name: 'Jordan Vale', roleLabel: 'Closer', total: 2394, raw: 2394, hoursMissing: false, lines: [
      { kind: 'Commission', what: '26-0141 · 12 Example Maple Ln', math: '$18,400 × 7% closer = $1,288', amount: 1288, jobId: 'j1', jobNumber: '26-0141', participantRole: 'sales_rep' },
      { kind: 'Commission', what: '26-0144 · 408 Sample Birch Ct that has a very long address line to wrap', math: '$12,600 × 7% closer = $882', amount: 882, jobId: 'j2', jobNumber: '26-0144', participantRole: 'sales_rep' },
      { kind: 'Commission', what: '26-0129 · 19 Imaginary Elm Ave', math: '$9,200 × 7% closer = $644, reduced to $224 to stay inside the 18% pool', amount: 224, jobId: 'j3', jobNumber: '26-0129', participantRole: 'sales_rep' },
    ] },
    { userId: 'u-riley', name: 'Riley Moss', roleLabel: 'Setter', total: 920, raw: 920, hoursMissing: false, lines: [{ kind: 'Commission', what: '26-0141 · 12 Example Maple Ln', math: '$18,400 × 5% setter = $920', amount: 920, jobId: 'j1', jobNumber: '26-0141', participantRole: 'setter' }] },
    { userId: 'u-sky', name: 'Sky Arden', roleLabel: 'Field Marketer', total: 500, raw: 500, hoursMissing: false, lines: [{ kind: 'Commission', what: '26-0144 · 408 Sample Birch Ct', math: '$6,000 × 3% setter = $180', amount: 180, jobId: 'j2', jobNumber: '26-0144', participantRole: 'setter' }, { kind: 'Minimum', what: 'Weekly minimum', math: 'Greater of $500 or earnings: $500 − $180 earned = $320', amount: 320 }] },
    { userId: 'u-casey', name: 'Casey Park', roleLabel: 'Sales manager', total: 1104, raw: 1104, hoursMissing: false, lines: [{ kind: 'Commission', what: '26-0141 · 12 Example Maple Ln', math: '$18,400 × 6% sales manager override = $1,104', amount: 1104, jobId: 'j1', jobNumber: '26-0141', participantRole: 'closer_manager_override' }] },
    { userId: 'u-taylor', name: 'Taylor Finch', roleLabel: 'Setter', total: 630, raw: 630, hoursMissing: false, lines: [{ kind: 'Commission', what: '26-0144 · 408 Sample Birch Ct', math: '$12,600 × 5% setter = $630', amount: 630, jobId: 'j2', jobNumber: '26-0144', participantRole: 'setter' }] },
    { userId: 'u-mia', name: 'Mia Cruz', roleLabel: 'Canvasser', total: 190.5, raw: 190.5, hoursMissing: false, lines: [{ kind: 'Hourly', what: 'Hourly', math: '10.5 hrs × $18', amount: 189 }, { kind: 'Units', what: 'Per-unit pay', math: 'Per-unit pay from the comp plan', amount: 1.5 }] },
    { userId: 'u-avery', name: 'Avery Lin', roleLabel: 'Canvasser', total: 0, raw: 0, hoursMissing: true, lines: [] },
  ],
  jobs: [
    { jobId: 'j1', jobNumber: '26-0141', address: '12 Example Maple Ln', commissionBase: 18400, total: 3312, paid: [
      { userId: 'u-jordan', name: 'Jordan Vale', roleLabel: 'closer', amount: 1288, math: '$18,400 × 7% closer = $1,288' },
      { userId: 'u-riley', name: 'Riley Moss', roleLabel: 'setter', amount: 920, math: '$18,400 × 5% setter = $920' },
      { userId: 'u-casey', name: 'Casey Park', roleLabel: 'sales manager override', amount: 1104, math: '$18,400 × 6% sales manager override = $1,104' },
    ] },
  ],
  waiting: [
    { jobId: 'j4', jobNumber: '26-0150', address: '5 Fictional Oak Dr', reason: 'Customer still owes $4,200 of $21,000', who: [{ name: 'Jordan Vale', roleLabel: 'closer', estimate: 1470 }, { name: 'Riley Moss', roleLabel: 'setter', estimate: 1050 }] },
    { jobId: 'j5', jobNumber: '26-0152', address: '290 Mock Cedar Way', reason: 'Install not marked complete', who: [{ name: 'Jordan Vale', roleLabel: 'closer', estimate: 1106 }] },
  ],
  earlier: [{ id: 'e1', weekEnding: '2026-10-14', payDate: '2026-10-16', status: 'locked' }],
  nextWeek: null,
  directory: [{ id: 'u-jordan', name: 'Jordan Vale' }, { id: 'u-riley', name: 'Riley Moss' }, { id: 'u-casey', name: 'Casey Park' }],
}

/** The "Change who gets what" sheet for one job (fictional). */
export const JOB_SPLIT = {
  periodId: '00000000-0000-4000-8000-000000000001',
  job: { id: 'j1', number: '26-0141', address: '12 Example Maple Ln', base: 18400 },
  capPercent: 18,
  status: 'Pays on this check',
  lines: [
    { key: 'u-jordan|sales_rep', userId: 'u-jordan', name: 'Jordan Vale', role: 'sales_rep', storageRole: 'closer', word: 'closer', percent: 7, amount: 1288, setByOffice: false },
    { key: 'u-riley|setter', userId: 'u-riley', name: 'Riley Moss', role: 'setter', storageRole: 'setter', word: 'setter', percent: 5, amount: 920, setByOffice: true },
    { key: 'u-casey|closer_manager_override', userId: 'u-casey', name: 'Casey Park', role: 'closer_manager_override', storageRole: 'closer_manager_override', word: 'sales manager override', percent: 6, amount: 1104, setByOffice: false },
  ],
  people: [{ id: 'u-jordan', name: 'Jordan Vale' }, { id: 'u-riley', name: 'Riley Moss' }, { id: 'u-casey', name: 'Casey Park' }, { id: 'u-sky', name: 'Sky Arden' }],
}

/** Pay-week settings sheet: current schedule + the dates preview. */
export const PAY_WEEK_SCHEDULE = { schedule: { weekStartDay: 4, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: null }, timeZone: 'America/New_York', words: 'Thursday–Wednesday · closes Wednesday 11:59 PM · paid Friday', canEdit: true }
export const PAY_WEEK_SCHEDULE_PREVIEW = {
  current: { schedule: PAY_WEEK_SCHEDULE.schedule, words: PAY_WEEK_SCHEDULE.words },
  next: { schedule: { weekStartDay: 1, cutoffTime: '23:59', paydayWeekday: 5, lateFunding: { weekday: 3, time: '23:59' } }, words: 'Monday–Sunday · closes Sunday 11:59 PM · paid Friday · money in by Wednesday 11:59 PM still pays that week' },
  unchanged: false,
  preview: { firstWeek: { start: '2026-11-12', end: '2026-11-15', payDate: '2026-11-20', days: 4 }, then: [{ start: '2026-11-16', end: '2026-11-22', payDate: '2026-11-27' }, { start: '2026-11-23', end: '2026-11-29', payDate: '2026-12-04' }] },
  blockers: [],
  oldWeeks: [{ periodId: 'w-old', weekEnding: '2026-11-11', movesTo: '2026-11-15', what: 'fixes' }],
}

export const MY_PAY = {
  name: 'Jordan Vale',
  headline: { amount: 2394, state: 'draft', payDate: '2026-10-23' },
  thisWeek: [
    { key: 't1', title: '26-0141 · 12 Example Maple Ln', why: "On Friday's check (2026-10-23).", amount: 1288, math: '$18,400 × 7% closer = $1,288', jobId: 'j1', lineKind: 'Commission' },
    { key: 't2', title: '26-0144 · 408 Sample Birch Ct, a very long address that has to wrap on a phone', why: "On Friday's check (2026-10-23).", amount: 882, math: '$12,600 × 7% closer = $882', jobId: 'j2', lineKind: 'Commission' },
    { key: 't3', title: '26-0129 · 19 Imaginary Elm Ave', why: "On Friday's check (2026-10-23).", amount: 224, math: '$9,200 × 7% closer = $644, reduced to $224 to stay inside the 18% pool', jobId: 'j3', lineKind: 'Commission' },
    { key: 't4', title: 'Weekly minimum', why: "On the Friday check (2026-10-23).", amount: 0, math: 'Greater of $500 or earnings: $500 − $2,394 earned = $0', lineKind: 'Minimum' },
  ],
  coming: [
    { key: 'c1', title: '26-0150 · 5 Fictional Oak Dr', why: 'Customer still owes $4,200 of $21,000', amount: 1470, math: 'Estimate: closer line on this job', jobId: 'j4', lineKind: 'Commission' },
    { key: 'c2', title: '26-0152 · 290 Mock Cedar Way', why: 'Install not marked complete', amount: 1106, math: 'Estimate: closer line on this job', jobId: 'j5', lineKind: 'Commission' },
  ],
  comingTotal: 2576,
  paid: [{ periodId: 'p-old', payDate: '2026-10-16', total: 980, lines: [{ key: 'p1', title: '26-0120 · 731 Pretend Spruce Ln', why: 'Paid 2026-10-16.', amount: 980, math: '$14,000 × 7% closer = $980', jobId: 'j6', lineKind: 'Commission' }] }],
  disputes: [{ id: 'd1', label: '26-0120 · 731 Pretend Spruce Ln', message: 'I closed this alone', status: 'open', reply: null, createdAt: '2026-10-20T12:00:00Z' }],
  nextWeekFixes: [],
}

const msg = (o: Record<string, unknown>) => ({ user_id: 'u2', author_name: 'Sam (closer)', type: 'note', body: '', created_at: '2026-10-21T16:12:00Z', audience: 'team', priority: null, restricted_pricing: false, origin: 'human', reply_to_id: null, mentioned_user_ids: [], pinned_at: null, pin_scope: null, pin_expires_at: null, edited_at: null, deleted: false, legacy: false, ...o })
export const HARNESS_THREAD = {
  messages: [
    msg({ id: 'm5', author_name: 'Riley (ops)', audience: 'production', body: 'Materials ordered, delivery Wed AM. Dumpster goes on the street, not the driveway.', created_at: '2026-10-22T13:02:00Z' }),
    msg({ id: 's1', origin: 'system', type: 'status_change', user_id: null, author_name: null, body: 'Status → Scheduled', created_at: '2026-10-22T12:00:00Z' }),
    msg({ id: 'm4', body: '@Riley Ops can you confirm the dumpster drop? She asked twice.', priority: 'needs_reply', mentioned_user_ids: ['u3'], created_at: '2026-10-21T21:40:00Z' }),
    msg({ id: 'm3', author_name: 'Sam (closer)', audience: 'sales', restricted_pricing: true, body: 'Signed at $18,400, gave $500 off for cash. Wife picked Onyx.', created_at: '2026-10-21T19:48:00Z' }),
    msg({ id: 'm1', user_id: 'u1', author_name: 'Jordan (setter)', body: 'Homeowner works nights, best time is after 2pm. Big dog, friendly.', created_at: '2026-10-21T16:12:00Z' }),
  ],
  pinned: [msg({ id: 'p1', body: 'Dog in back yard. Gate code 4471. Call before arrival.', pinned_at: '2026-10-21T16:20:00Z', pin_scope: 'customer' })],
  nextBefore: '2026-10-21T16:12:00Z',
  hiddenSalesCount: 0,
  writable: ['team', 'sales', 'production', 'crew'],
  defaultAudience: 'team',
  canAllowSetters: true,
  canPin: true,
  viewerId: 'u2',
  isOwner: true,
  seesSalesHistoryChip: false,
}

export const HARNESS_FILE_CTX = {
  customer: { id: 'c1', name: 'Ashley Gaines', phone: '(704) 555-0142', email: 'ashley@example.com', address_text: '1423 Maple Ridge Dr, Concord NC' },
  deal: { id: 'd2', owner_user_id: 'u2', setter_user_id: 'u1', customer_id: 'c1', lead_id: null, address_text: '1423 Maple Ridge Dr, Concord NC', status: 'won' },
  deals: [
    { id: 'd2', address_text: '1423 Maple Ridge Dr, Concord NC', status: 'won', created_at: '2026-10-01T12:00:00Z' },
    { id: 'd1', address_text: '1423 Maple Ridge Dr, Concord NC', status: 'won', created_at: '2016-04-01T12:00:00Z' },
  ],
  job: { id: 'j1', job_number: '26-0026', status: 'in_progress', project_id: 'p1', sale_amount: 18400, scheduled_date: '2026-10-29', completed_at: null, payroll_sent_at: null, materials_status: 'ordered', materials_eta: '2026-10-28' },
  stages: [
    { key: 'lead', label: 'Lead', tab: 'sales', state: 'done' },
    { key: 'inspection', label: 'Inspection', tab: 'sales', state: 'done' },
    { key: 'proposal', label: 'Proposal', tab: 'sales', state: 'done' },
    { key: 'signed', label: 'Signed', tab: 'sales', state: 'done' },
    { key: 'scheduled', label: 'Scheduled', tab: 'job', state: 'done' },
    { key: 'installed', label: 'Installed', tab: 'job', state: 'current' },
    { key: 'paid', label: 'Paid', tab: 'money', state: 'todo' },
    { key: 'payroll', label: 'Payroll', tab: 'money', state: 'todo' },
  ],
  next: { label: 'Mark installed', tab: 'job' },
  tabs: ['overview', 'sales', 'job', 'money', 'files', 'notes'],
  pinned: [{ id: 'p1', body: 'Dog in back yard. Gate code 4471. Call before arrival.' }],
}

export const HARNESS_WORK_ORDERS = [
  { id: 'w1', work_order_number: 'WO-0015', title: 'Go-back: ridge cap lifting at rear slope', work_order_type: 'go_back', status: 'pending', priority: 'high', address: '12 Elm St', city: 'Concord', state: 'NC', scheduled_date: null, created_at: '2026-10-20T12:00:00Z', customers: { id: 'c1', name: 'Ashley Gaines' }, assigned_user: null, assigned_sub: { id: 's1', company_name: 'Carolina Roofing' } },
  { id: 'w2', work_order_number: 'WO-0014', title: 'Warranty: skylight leak', work_order_type: 'warranty', status: 'scheduled', priority: 'normal', address: '88 Oak Ave', city: 'Kannapolis', state: 'NC', scheduled_date: '2026-10-29', created_at: '2026-10-18T12:00:00Z', customers: { id: 'c2', name: 'Bill Cox' }, assigned_user: { id: 'u1', full_name: 'Steve Potts' }, assigned_sub: null },
  { id: 'w3', work_order_number: 'WO-0012', title: 'Punch list', work_order_type: 'punch_list', status: 'completed', priority: 'low', address: '4 Pine Rd', city: 'Concord', state: 'NC', scheduled_date: '2026-10-02', created_at: '2026-09-30T12:00:00Z', customers: null, assigned_user: null, assigned_sub: null },
]
export const HARNESS_CUSTOMERS = [
  { id: 'c1', name: 'Ashley Gaines', phone: '(704) 555-0142', email: 'ashley@example.com', address_text: '1423 Maple Ridge Dr, Concord NC', bought: true },
  { id: 'c2', name: 'Bill Cox', phone: '(704) 555-0199', email: 'bill@example.com', address_text: '88 Oak Ave, Kannapolis NC', bought: true },
  { id: 'c3', name: 'Dana Whitfield', phone: null, email: null, address_text: '9 Birch Ln, Concord NC', bought: false },
]
export const HARNESS_PROPOSALS = {
  role: 'admin', current_user_id: 'u1',
  proposals: [
    { id: 'p1', proposal_number: 'P-00118', customer_name: 'Ashley Gaines', customer_address: '1423 Maple Ridge Dr, Concord NC', title: 'Roof replacement', status: 'accepted', total: 18400, created_at: '2026-10-01T12:00:00Z', sent_at: null, created_by: 'u1', users: { full_name: 'Nathan Hall' } },
    { id: 'p2', proposal_number: 'P-00121', customer_name: 'Dana Whitfield', customer_address: '9 Birch Ln, Concord NC', title: 'Roof + gutters', status: 'sent', total: 24310, created_at: '2026-10-19T12:00:00Z', sent_at: '2026-10-19T14:00:00Z', created_by: 'u1', users: { full_name: 'Nathan Hall' } },
    { id: 'p3', proposal_number: 'P-00122', customer_name: 'Lee Park', customer_address: '3 Cedar Ct, Concord NC', title: 'Repair', status: 'draft', total: 2300, created_at: '2026-10-21T12:00:00Z', sent_at: null, created_by: 'u2', users: { full_name: 'Sam Closer' } },
  ],
}
export const HARNESS_LEADS = {
  leads: [
    { id: 'l1', homeowner_name: 'Ashley Gaines', email: 'a@example.com', phone: '(704) 555-0142', address_text: '1423 Maple Ridge Dr', status: 'new', source: 'door', source_type: null, channel: 'outbound', campaign_id: null, lead_source_id: null, owner_user_id: 'u1', owner_display_name: 'Jordan Setter', created_at: '2026-10-20T12:00:00Z', users: { full_name: 'Jordan Setter' }, campaigns: null, lead_sources: null, opportunity_id: null },
    { id: 'l2', homeowner_name: 'Bill Cox', email: null, phone: '(704) 555-0199', address_text: '88 Oak Ave', status: 'appointment', source: 'web', source_type: null, channel: 'inbound', campaign_id: null, lead_source_id: null, owner_user_id: null, owner_display_name: null, created_at: '2026-10-19T12:00:00Z', users: null, campaigns: { name: 'Fall storm' }, lead_sources: { name: 'Website' }, opportunity_id: 'o1' },
  ],
  pagination: { page: 1, limit: 50, total: 2, totalPages: 1, hasMore: false },
}
export const HARNESS_PROFIT_ROWS = [
  { id: 'j1', jobNumber: '26-0041', lastName: 'Gaines', customerName: 'Ashley Gaines', address: '1423 Maple Ridge Dr, Concord NC', saleDate: '2026-10-01', saleAmount: 18400, financeCost: 0, commissionBase: 18400, materials: 6100, labor: 4060, misc: 0, totalExpenses: 10160, commission: 2760, commissionNote: 'pays next week', grossProfit: 5480, grossPercent: 29.78, notes: 'Dumpster on the street', status: 'Deposit Received', unreviewed: true },
  { id: 'j2', jobNumber: '26-0038', lastName: 'Cox', customerName: 'Bill Cox', address: '88 Oak Ave, Kannapolis NC', saleDate: '2026-09-12', saleAmount: 16325, financeCost: 900, commissionBase: 16325, materials: 5200, labor: 4060, misc: 200, totalExpenses: 9460, commission: null, commissionNote: null, grossProfit: null, grossPercent: null, notes: null, status: 'Reconciled & Closed', unreviewed: false },
]

export const HARNESS_APPOINTMENTS = {
  canReassign: true,
  users: [{ id: 'u1', full_name: 'Sam Closer', role: 'sales_rep' }, { id: 'u2', full_name: 'Nathan Hall', role: 'admin' }],
  appointments: [
    { id: 'a1', lead_id: 'l1', opportunity_id: 'o1', scheduled_for: '2099-01-10T15:00:00Z', duration_minutes: 60, address_text: '1423 Maple Ridge Dr, Concord NC', notes: null, status: 'scheduled', closer_user_id: 'u1', canvasser_user_id: 'u2', leads: { homeowner_name: 'Ashley Gaines', phone: '(704) 555-0142' }, closer: { id: 'u1', full_name: 'Sam Closer' }, setter: { id: 'u2', full_name: 'Jordan Setter' }, feedback: null },
    { id: 'a2', lead_id: 'l2', opportunity_id: null, scheduled_for: '2026-10-01T15:00:00Z', duration_minutes: 45, address_text: '88 Oak Ave, Kannapolis NC', notes: null, status: 'scheduled', closer_user_id: 'u1', canvasser_user_id: null, leads: { homeowner_name: 'Bill Cox', phone: null }, closer: { id: 'u1', full_name: 'Sam Closer' }, setter: null, feedback: null },
    { id: 'a3', lead_id: 'l3', opportunity_id: 'o3', scheduled_for: '2026-09-20T15:00:00Z', duration_minutes: 60, address_text: '9 Birch Ln', notes: null, status: 'completed', closer_user_id: 'u1', canvasser_user_id: null, leads: { homeowner_name: 'Dana Whitfield', phone: null }, closer: { id: 'u1', full_name: 'Sam Closer' }, setter: null, feedback: { outcome: 'sale', notes: 'Moving forward', setter_feedback: null, completed_at: '2026-09-20T17:00:00Z' } },
  ],
}


// Operations Dashboard (components/ops/OpsDashboardView): long names and addresses on purpose, urgent + on-hold callouts.
export const HARNESS_OPS_DASHBOARD = {
  today: new Date('2026-10-26T14:00:00Z'),
  canJobBoard: true,
  canFixPayPlans: true,
  needsYou: HARNESS_NEEDS_YOU,
  needsYouAudience: 'owner' as const,
  pipelineStats: { sold: 7, materials: 4, scheduled: 9, in_progress: 3, complete: 12 },
  totalActive: 35,
  urgentJobs: 2,
  onHoldJobs: 1,
  todaysJobsList: [
    { id: 'j1', job_number: '26-0042', status: 'in_progress', priority: 'urgent', address_text: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117', scheduled_time_start: '07:30', assigned_crew: { id: 'c1', name: 'Hernandez Roofing Crew A', color: '#2d6a4f' }, assigned_sub: null, customer: { name: 'Bartholomew Featherstonehaugh-Smythe', phone: '7049038092' } },
    { id: 'j2', job_number: '26-0043', status: 'scheduled', priority: 'normal', address_text: '12 Elm Street, Concord NC 28025', scheduled_time_start: null, assigned_crew: null, assigned_sub: { id: 's1', company_name: 'Sparky Gutters and Exteriors LLC' }, customer: { name: 'Ashley Gaines', phone: null } },
  ],
  upcomingJobsList: [
    { id: 'j3', job_number: '26-0044', status: 'scheduled', scheduled_date: '2026-10-28', address_text: '88 Oak Lane Extension Road, Kannapolis NC 28081', assigned_crew: { id: 'c2', name: 'Crew B', color: '#9d4edd' }, assigned_sub: null },
  ],
  crews: [{ id: 'c1', name: 'Hernandez Roofing Crew A', color: '#2d6a4f', crew_type: 'roofing' }, { id: 'c2', name: 'Crew B', color: '#9d4edd', crew_type: 'gutters' }],
  materialsNeeded: [{ id: 'j2', job_number: '26-0043', address_text: '12 Elm Street, Concord NC 28025', materials_status: 'not_ordered', materials_eta: null }],
  recentNotes: [{ id: 'n1', created_at: '2026-10-25T15:00:00Z', note: 'Customer asked for the crew to park on the street, not the driveway. Please confirm the dumpster drop for Tuesday morning.', production_job: { id: 'j1', job_number: '26-0042' }, user: { full_name: 'Nathan Hall' } }],
}


// Ops → Schedule (InstallScheduleClient): long names on purpose. Dates are relative to today so the week window always has jobs.
const weekDayISO = (dow: number) => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + dow); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const dayISO = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** The standard trades list as the server sends it (lib/org-trades.ts tradeOptions). */
export const HARNESS_ORG_TRADES = [
  { slug: 'roofing', label: 'Roofing', active: true },
  { slug: 'gutters', label: 'Gutters', active: true },
  { slug: 'siding', label: 'Siding', active: true },
  { slug: 'windows', label: 'Windows', active: true },
  { slug: 'other', label: 'Other', active: true },
]

/** Settings → Job setup → Trades (GET /api/admin/job-setup/trades). A long custom name and an inactive trade test wrapping. */
export const JOB_SETUP_TRADES = {
  editable: true,
  trades: [
    { slug: 'roofing', label: 'Roofing', sort: 10, active: true, matchKeywords: null },
    { slug: 'gutters', label: 'Gutters', sort: 20, active: true, matchKeywords: ['gutter', 'downspout'] },
    { slug: 'siding', label: 'Siding', sort: 30, active: true, matchKeywords: ['siding'] },
    { slug: 'windows', label: 'Windows', sort: 40, active: false, matchKeywords: ['\\bwindows?\\b'] },
    { slug: 'solar_panel_removal_reinstall', label: 'Solar panel removal & reinstall', sort: 50, active: true, matchKeywords: null },
    { slug: 'other', label: 'Other', sort: 60, active: true, matchKeywords: null },
  ],
}

export const HARNESS_INSTALL_SCHEDULE = {
  orgTrades: HARNESS_ORG_TRADES,
  subs: [
    { id: 's1', company_name: 'Hernandez Roofing and Exteriors LLC', services: ['roofing'], scheduling_email: 'crew@hernandez.test', phone: '7045550142' },
    { id: 's2', company_name: 'Sparky Gutters', services: ['gutters'], scheduling_email: null, phone: null },
  ],
  scheduled: [
    { id: 'w1', job_id: 'j1', job_number: '26-0042', trade: 'roofing', customer_name: 'Bartholomew Featherstonehaugh-Smythe', address_text: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117', scheduled_date: weekDayISO(2), scheduled_time_start: null, install_days: 1, assigned_sub_id: 's1', status: 'scheduled', job_status: 'scheduled', total_squares: 28.5 },
    { id: 'w2', job_id: 'j2', job_number: '26-0043', trade: 'gutters', customer_name: 'Ashley Gaines', address_text: '12 Elm Street, Concord NC 28025', scheduled_date: weekDayISO(3), scheduled_time_start: '07:30', install_days: 2, assigned_sub_id: 's2', status: 'scheduled', job_status: 'scheduled', total_squares: null },
  ],
  unscheduled: [
    { id: 'w3', job_id: 'j3', job_number: '26-0044', trade: 'roofing', customer_name: 'Bill Cox', address_text: '88 Oak Lane Extension Road, Kannapolis NC 28081', job_status: 'sold', total_squares: 31, sold_at: dayISO(-3) },
  ],
}

// Referral Partners list.
export const HARNESS_PARTNERS = {
  partners: [
    { id: 'rp1', org_id: 'org-1', type_id: 't1', other_type_text: null, name: 'Concord Realty Group of the Carolinas', phone: '7049038092', email: 'hello@concordrealty.test', company: 'Concord Realty Group', notes: null, assigned_user_id: 'u1', status: 'assigned', assigned_at: '2026-09-01T12:00:00Z', last_touched_at: '2026-10-10T12:00:00Z', created_by: 'u1', created_at: '2026-09-01T12:00:00Z', type: { id: 't1', name: 'Realtor', inactivity_days: 60 }, assignee: { id: 'u1', full_name: 'Nathan Hall' }, days_until_open: 3, is_mine: true, similar: false },
    { id: 'rp2', org_id: 'org-1', type_id: 't2', other_type_text: null, name: 'Mooresville Insurance Adjusters', phone: null, email: null, company: null, notes: null, assigned_user_id: null, status: 'open', assigned_at: null, last_touched_at: '2026-08-01T12:00:00Z', created_by: 'u1', created_at: '2026-08-01T12:00:00Z', type: { id: 't2', name: 'Adjuster', inactivity_days: 45 }, assignee: null, days_until_open: null, is_mine: false, similar: false },
  ],
}


// Inside Sales queue (app/inside-sales/page.tsx).
const iso = (offsetHours: number) => new Date(Date.now() + offsetHours * 3600_000).toISOString()
const insideItem = (id: string, name: string, phone: string | null, kind: 'didnt_sit' | 'handoff' | 'knockback' | 'storm') => ({
  id, customerName: name, customerPhone: phone, address_text: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117',
  inspection_notes: 'Customer wants gutters quoted too.', follow_up_at: iso(-5), created_at: iso(-72), followUpKind: kind, followUpOutcomeLabel: 'Did not sit',
  knockback_reason: null, closerName: 'Sam Closer', assignedToName: null, callableNow: true, eligibleAtIso: null,
  story: 'Inspection was set for Tuesday but the homeowner was not home when the closer arrived.', objective: 'Get them rebooked',
  handoffContext: null, attemptCount: 2, lastAttemptAt: iso(-30), lastAttemptSummary: 'Left voicemail', daysInQueue: 3, overdueDays: 1, priorityTier: 1,
  activities: [], adjusterMeetingSync: null,
})
export const HARNESS_INSIDE_SALES = {
  canView: true, canSelfAssign: true,
  counts: { total: 3, readyToCall: 3, didntSit: 2, handoff: 1, knockback: 0, storm: 0, dueNow: 3, neverAttempted: 0, overdue: 1 },
  items: [
    insideItem('o1', 'Bartholomew Featherstonehaugh-Smythe', '7049038092', 'didnt_sit'),
    insideItem('o2', 'Ashley Gaines', '(704) 707-6274', 'handoff'),
    insideItem('o3', 'Bill Cox', null, 'didnt_sit'),
  ],
}


// Incentives (app/sisu/IncentivesClient.tsx).
export const HARNESS_INCENTIVES = {
  profile: { id: 'u1', org_id: 'org-1', full_name: 'Bartholomew Featherstonehaugh-Smythe', role: 'sales_rep', email: 'b@example.test' },
  liveMetrics: { inspectionsSet: 6, doorsKnocked: 212, doorsKnockedForBadge: 212, closedSales: 2, closedSalesMonth: 5 },
  goal: { id: 'g1', weekly_doors_target: 300, weekly_inspections_target: 8, weekly_sales_target: 3, weekly_revenue_target: 50000, effective_from: '2026-10-01', effective_to: null },
  activeSpiffs: [
    { id: 'h1', name: 'Fall Storm Sprint — Most Inspections Set This Week', description: 'Set the most inspections Monday to Friday.', trigger_metric: 'inspections_set', threshold: 10, reward_type: 'cash', reward_amount: 250, reward_note: null, eligible_roles: ['sales_rep'], starts_at: '2026-10-19T04:00:00Z', ends_at: '2026-10-31T04:00:00Z', status: 'active', currentValue: 6, qualified: false },
  ],
  earnedBadges: [],
  isSetterLike: false,
  approvedBonuses: [{ id: 'b1', bonus_type: 'spiff', amount: 250, source_id: null, status: 'approved', scheduled_pay_date: '2026-10-30' }],
  metricsAsOf: new Date().toISOString(),
}
export const HARNESS_LEADERBOARD = {
  setters: [
    { user_id: 'u9', full_name: 'Jordan Setter-Longname Hernandez', role: 'setter', primary_metric: 14, doors_knocked: 480, rank: 1, badge_count: 2 },
    { user_id: 'u8', full_name: 'Sam Setter', role: 'setter', primary_metric: 9, doors_knocked: 301, rank: 2 },
  ],
  closers: [{ user_id: 'u1', full_name: 'Bartholomew Featherstonehaugh-Smythe', role: 'sales_rep', primary_metric: 2, doors_knocked: 0, rank: 1 }],
  asOf: new Date().toISOString(),
}


// Projects list (components/projects/ProjectsView).
export const HARNESS_PROJECTS = {
  projects: [
    { id: 'p1', address_text: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117', project_type: 'roofing', status: 'in_progress', customers: { name: 'Bartholomew Featherstonehaugh-Smythe' }, leads: null, production_jobs: [{ status: 'in_progress' }] },
    { id: 'p2', address_text: '12 Elm Street, Concord NC 28025', project_type: 'roofing', status: 'open', customers: null, leads: { homeowner_name: 'Ashley Gaines' }, production_jobs: [] },
  ],
  projectsError: null,
  closerByProjectId: { p1: 'Sam Closer-Longname Hernandez', p2: 'Nathan Hall' },
}

/** Shaped like prod job 26-0037: roofing crew date already past with photos missing, gutters later, materials marked received but no supplier orders on file, balance owed. */
export const HARNESS_JOB_0037 = {
  ...HARNESS_JOB,
  id: 'job-0037', job_number: '26-0037', status: 'scheduled', sale_amount: 16325, collected_cents: 163250,
  materials_status: 'received', materials_ordered_at: '2026-10-08T12:00:00Z', scheduled_date: '2026-10-20', completed_at: null, started_at: null,
  sold_scope: null, installation_agreement: { pdf_url: 'https://example.test/agreement.pdf', status: 'completed', agreement_type: 'installation' },
  roof_report: { id: 'rr1', pdf_generated_at: '2026-10-02T12:00:00Z' },
}
export const HARNESS_TRADES_0037 = {
  orgTrades: HARNESS_ORG_TRADES,
  trades: [
    { id: 't1', work_order_number: 'WO-0101', trade: 'roofing', trade_source: 'auto', status: 'scheduled', scheduled_date: '2026-10-20', scheduled_time_start: null, install_days: 1, completed_at: null,
      sub: { id: 's1', company_name: 'Sparky Roofing LLC', phone: '7045550101', has_scheduling_email: true }, calendar_sync_error: null, has_calendar_event: true,
      missing_photo_tags: ['left', 'right'], photo_count: 2, crew_link_url: 'https://example.test/crew/abc' },
    { id: 't2', work_order_number: 'WO-0102', trade: 'gutters', trade_source: 'auto', status: 'scheduled', scheduled_date: '2026-10-27', scheduled_time_start: null, install_days: 0.5, completed_at: null,
      sub: { id: 's2', company_name: 'Rain Gutters Co', phone: '7045550102', has_scheduling_email: false }, calendar_sync_error: null, has_calendar_event: false,
      missing_photo_tags: ['front', 'back', 'left', 'right'], photo_count: 0, crew_link_url: null },
  ],
}
export const HARNESS_PAYMENTS_0037 = { payments: [{ id: 'pay1', job_id: 'job-0037', paid_at: '2026-10-02', amount_cents: 163250, payment_type: 'deposit', method: 'check', payer: 'homeowner', note: null, created_at: '2026-10-02T12:00:00Z', created_by: 'u1', funding_status: 'cleared' }], collected_cents: 163250, collected_dollars: 1632.5, sale_amount_cents: 1632500, sale_amount_dollars: 16325, remaining_cents: 1469250, remaining_dollars: 14692.5, payment_count: 1, paid_in_full: false, paid_by_payments: false }
export const SUPPLIER_VIEW_0037 = { jobNumber: '26-0037', jobCancelled: false, canSend: true, rollup: { parts: [], covered: 0, total: 0, allCovered: false, summary: '' }, blockers: [], warnings: [], cards: [], nonPo: [], unassigned: [], trades: [], lines: [], suppliers: [], defaultDeliveryDate: null, defaultDeliveryAddress: null }

/** The harness viewer (board "My jobs"). */
export const HARNESS_VIEWER_ID = 'u-harness'
export const HARNESS_OWNER_CANDIDATES = { candidates: [{ id: 'u-harness', name: 'Dana Example' }, { id: 'u-steve', name: 'Steve Potts' }] }

/** Job catch-up (lib/job-catch-up.ts) as the server sends it: one moving, one stuck, one with the next crew date. */
const catchUp = (over: Record<string, unknown>) => ({
  jobId: 'job-1', threadHref: '/c/c1/d/o1/notes', stage: 'In Progress', nextStep: 'Roofing crew on site', owner: 'Steve', ownerKind: 'assigned', ownerUserId: 'u-steve',
  lastUpdate: { at: '2026-11-05T14:00:00Z', what: 'Roofing crew scheduled for Nov 5', who: 'Sparky Roofing LLC', kind: 'event' }, ageDays: 1, idleWorkingDays: 1, ageLabel: '1d',
  stuck: false, reasons: [] as string[], line: 'Steve · Roofing crew on site · 1d',
  lastContact: { at: '2026-11-03T15:30:00Z', what: 'Call: Customer asked if the crew can park on the street and start after 8am', who: 'Andrew Waltz', kind: 'contact' }, contactIsNote: false,
  recent: [
    { at: '2026-11-05T14:00:00Z', what: 'Roofing crew scheduled for Nov 5', who: 'Sparky Roofing LLC', kind: 'event' },
    { at: '2026-11-04T19:12:00Z', what: 'Permit office says it clears Monday; dumpster drop confirmed for the morning of install.', who: 'Steve Potts', kind: 'note' },
    { at: '2026-11-03T15:30:00Z', what: 'Call: Customer asked if the crew can park on the street and start after 8am', who: 'Andrew Waltz', kind: 'contact' },
  ],
  done: false,
  ...over,
})
export const HARNESS_CATCH_UP_STUCK = catchUp({
  jobId: 'job-2', stage: 'Sold', nextStep: 'Order materials', owner: 'No owner', ownerKind: 'unassigned', ownerUserId: null, ageDays: 9, idleWorkingDays: 7, ageLabel: '9d', stuck: true,
  reasons: ["Crew starts 2026-11-08 and materials aren't marked ordered.", 'Nothing has moved in 7 working days.'], line: 'No owner · Order materials · 9d',
  lastContact: { at: '2026-10-28T14:00:00Z', what: 'Waiting to hear back from the HOA about the shingle color before we order.', who: 'Steve Potts', kind: 'note' }, contactIsNote: true,
})
export const HARNESS_CATCH_UP_JOBS = HARNESS_OPS_JOBS.map((j, i) =>
  i === 0
    ? { ...j, catch_up: catchUp({}) }
    : i === 1
      ? { ...j, catch_up: HARNESS_CATCH_UP_STUCK }
      : i === 3
        ? { ...j, catch_up: catchUp({ jobId: 'job-4', stage: 'Scheduled', nextStep: 'Roofing crew Nov 12', ageLabel: 'today', ageDays: 0, idleWorkingDays: 0, owner: 'Dana', ownerKind: 'assigned', ownerUserId: HARNESS_VIEWER_ID, line: 'Dana · Roofing crew Nov 12 · today' }) }
        : j
)

/** Customer checkups list (components/checkups/CheckupList.tsx). */
export const HARNESS_CHECKUPS = [
  {
    id: 'ck-1', production_job_id: 'job-1', customer_id: 'cust-1', opportunity_id: 'opp-1', month_offset: 6, kind: 'inspection', due_on: '2026-09-09',
    status: 'due', booked_for: null, result: null, notes: null, attempts: 2, last_attempt_at: '2026-11-02T15:00:00Z', assigned_user_id: 'u1', done_at: null,
    label: '6-month inspection', jobNumber: '26-0003', address: '1840 Featherstonehaugh Crossing Ln NW, Concord NC 28025', installedOn: '2026-03-09',
    customerName: 'Bartholomew Featherstonehaugh-Montgomery', phone: '7045550142', email: 'bart.featherstonehaugh@example.com', assigneeName: 'Nathan Hall',
  },
  {
    id: 'ck-2', production_job_id: 'job-2', customer_id: 'cust-2', opportunity_id: 'opp-2', month_offset: 24, kind: 'touch', due_on: '2026-11-01',
    status: 'due', booked_for: null, result: null, notes: null, attempts: 0, last_attempt_at: null, assigned_user_id: 'u1', done_at: null,
    label: '2-year check-in call', jobNumber: '24-0110', address: '22 Oak St, Concord NC 28025', installedOn: '2024-11-01',
    customerName: 'Pat Customer', phone: '7045550100', email: null, assigneeName: 'Nathan Hall',
  },
]

/** Properties + custom fields harness (lawn / landscape company with a commercial account). */
export const HARNESS_CUSTOM_FIELDS = {
  ready: true,
  definitions: [
    { id: 'cf-gate', entity: 'customer', label: 'Billing contact', field_type: 'text', options: [], required: false, sort: 10, active: true, visible_to_field: false },
    { id: 'cf-terms', entity: 'customer', label: 'Payment terms', field_type: 'dropdown', options: ['Due on receipt', 'Net 15', 'Net 30'], required: true, sort: 20, active: true, visible_to_field: false },
    { id: 'pf-day', entity: 'property', label: 'Mowing day', field_type: 'dropdown', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], required: false, sort: 10, active: true, visible_to_field: true },
    { id: 'pf-acres', entity: 'property', label: 'Acres', field_type: 'number', options: [], required: false, sort: 20, active: true, visible_to_field: false },
    { id: 'pf-old', entity: 'property', label: 'Old irrigation note', field_type: 'text', options: [], required: false, sort: 30, active: false, visible_to_field: false },
    { id: 'jf-crew', entity: 'job', label: 'Crew size', field_type: 'number', options: [], required: false, sort: 10, active: true, visible_to_field: false },
  ],
}

export const HARNESS_PROPERTIES = [
  {
    id: 'prop-1', customer_id: 'cust-1', label: 'Main office', address_line1: '2410 Crawfordville Hwy', address_line2: null, city: 'Crawfordville', state: 'FL', zip: '32327',
    address_text: '2410 Crawfordville Hwy, Crawfordville, FL 32327', lat: 30.1763, lng: -84.3752, notes: 'Front beds get mulch every spring.',
    access_notes: 'Gate code 4421. Dog in the back yard on weekdays — use the side gate.', active: true, source: 'manual',
    custom_fields: { 'pf-day': 'Tuesday', 'pf-acres': 1.5 }, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
  },
  {
    id: 'prop-2', customer_id: 'cust-1', label: 'Rental on Oak', address_line1: null, address_line2: null, city: null, state: null, zip: null,
    address_text: '88 Oak Ridge Rd, Wakulla Springs, FL 32327', lat: null, lng: null, notes: null, access_notes: null, active: true, source: 'backfill',
    custom_fields: {}, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
  },
  {
    id: 'prop-3', customer_id: 'cust-1', label: null, address_line1: '5 Old Shell Rd', address_line2: null, city: 'Medart', state: 'FL', zip: '32327',
    address_text: '5 Old Shell Rd, Medart, FL 32327', lat: null, lng: null, notes: null, access_notes: null, active: false, source: 'manual',
    custom_fields: { 'pf-old': 'Drip line by the mailbox' }, created_at: '2026-11-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z',
  },
]

export const HARNESS_CUSTOMER_DOCUMENTS = [
  { id: 'doc-1', title: 'Annual maintenance agreement 2027', filename: 'agreement.pdf', category: 'contract', property_id: 'prop-1', created_at: '2026-11-02T15:00:00Z' },
  { id: 'doc-2', title: 'Certificate of insurance', filename: 'coi.pdf', category: 'insurance', property_id: null, created_at: '2026-10-20T15:00:00Z' },
]

/** Service plans (a lawn company + a roof & gutter care plan with a follow-on inspection), from plan templates. */
const GYR = [
  { key: 'green', label: 'Green — looks good', tone: 'good' },
  { key: 'yellow', label: 'Yellow — watch / minor repair', tone: 'watch' },
  { key: 'red', label: 'Red — needs repair', tone: 'bad' },
]
const LAWN_SEASONS = [
  { from: '03-01', to: '03-31', frequency: 'every_2_weeks' },
  { from: '04-01', to: '10-31', frequency: 'weekly' },
  { from: '11-01', to: '11-30', frequency: 'every_2_weeks' },
  { from: '12-01', to: '02-29', frequency: 'monthly' },
]
const LAWN_PRICING = { fields: [{ key: 'lawn_sqft', label: 'Lawn size (sq ft)' }], tiers: [{ key: 'standard', label: 'Standard yard', price: 45, billingBasis: 'per_visit', conditions: [{ field: 'lawn_sqft', op: 'lte', value: 15000 }] }], allowCustom: true }
const CARE_PRICING = { fields: [{ key: 'stories', label: 'Stories' }, { key: 'pitch', label: 'Roof pitch (/12)' }], tiers: [{ key: 'standard', label: 'Standard home', price: 39, billingBasis: 'per_month', conditions: [{ field: 'stories', op: 'lte', value: 3 }, { field: 'pitch', op: 'lte', value: 10 }] }], allowCustom: true }
const CARE_STEPS = [{ key: 'inspection', label: 'Roof inspection', daysAfter: 2, assignTo: 'person', userId: 'u-insp', subId: null, results: GYR }]

export const HARNESS_PLAN_TEMPLATES = {
  ready: true,
  canEdit: true,
  templates: [
    { id: 'tpl-1', org_id: 'org-1', name: 'Lawn maintenance', trade: 'lawn', description: null, seasons: LAWN_SEASONS, billing_basis: 'per_visit', taxable: false, pricing: LAWN_PRICING, steps: [], active: true, version: 3, updated_at: '2026-11-01T12:00:00Z' },
    { id: 'tpl-2', org_id: 'org-1', name: 'Roof & gutter care', trade: 'gutters', description: null, seasons: [{ from: '04-01', to: '04-30', frequency: 'monthly' }], billing_basis: 'per_month', taxable: true, pricing: CARE_PRICING, steps: CARE_STEPS, active: true, version: 1, updated_at: '2026-11-01T12:00:00Z' },
  ],
  starters: [],
  trades: [{ slug: 'lawn', label: 'Lawn care' }, { slug: 'gutters', label: 'Gutters' }],
  crews: [{ id: 'sub-1', name: 'Green Team' }, { id: 'sub-2', name: 'Blue Team' }],
  people: [{ id: 'u-insp', name: 'Dana Inspector' }],
}

export const HARNESS_TEMPLATE_DETAIL = {
  template: HARNESS_PLAN_TEMPLATES.templates[0],
  plans: 12,
  behind: 4,
  history: [{ id: 'h1', action: 'updated', at: '2026-11-01T12:00:00Z', by: 'Owner', lines: ['Price rules: Standard yard $40 → Standard yard $45'] }],
}

const plan = (over: Record<string, unknown>) => ({
  org_id: 'org-1', customer_id: 'cust-1', description: null, taxable: false, pricing_inputs: {}, end_date: null, paused_until: null, route_position: null,
  created_by: 'u1', created_at: '2026-03-01T12:00:00Z', updated_at: '2026-03-01T12:00:00Z', priceHidden: false, template_version: 1, ...over,
})

export const HARNESS_SERVICE_PLANS = {
  ready: true,
  canEdit: true,
  prices: true,
  properties: [{ id: 'prop-1', name: 'Main office · 2410 Crawfordville Hwy' }, { id: 'prop-2', name: 'Rental on Oak · 88 Oak Ridge Rd' }],
  trades: HARNESS_PLAN_TEMPLATES.trades,
  crews: HARNESS_PLAN_TEMPLATES.crews,
  people: HARNESS_PLAN_TEMPLATES.people,
  templates: HARNESS_PLAN_TEMPLATES.templates,
  plans: [
    plan({ id: 'plan-1', property_id: 'prop-1', template_id: 'tpl-1', trade: 'lawn', name: 'Weekly mowing & edging', price: 55, billing_basis: 'per_visit', pricing: LAWN_PRICING, tier_key: null, steps: [], status: 'active', start_date: '2026-03-03', preferred_weekday: 2, default_sub_id: 'sub-1', route_position: 4, seasons: LAWN_SEASONS }),
    plan({ id: 'plan-2', property_id: 'prop-2', template_id: 'tpl-2', trade: 'gutters', name: 'Roof & gutter care', price: 39, billing_basis: 'per_month', taxable: true, pricing: CARE_PRICING, pricing_inputs: { stories: 2, pitch: 6 }, tier_key: 'standard', steps: CARE_STEPS, status: 'paused', start_date: '2026-04-01', paused_until: '2026-12-01', preferred_weekday: 3, default_sub_id: 'sub-2', seasons: [{ from: '04-01', to: '04-30', frequency: 'monthly' }, { from: '10-01', to: '11-30', frequency: 'monthly' }] }),
  ],
}

const visit = (over: Record<string, unknown>) => ({
  id: 'v', workOrderNumber: 'WO-00100', planId: 'plan-1', planName: 'Weekly mowing & edging', status: 'scheduled', scheduledDate: '2026-11-10', plannedDate: '2026-11-10', moved: false,
  trade: 'lawn', customerId: 'cust-1', customerName: 'Gulf Coast Property Group', propertyId: 'prop-1', address: '2410 Crawfordville Hwy, Crawfordville, FL 32327', lat: 30.17, lng: -84.37,
  accessNotes: 'Gate code 4421. Dog in back yard.', subId: 'sub-1', subName: 'Green Team', routePosition: 4, step: 'service', stepLabel: null, result: null, resultOptions: [], userId: null, userName: null,
  skipReason: null, notes: null, completedAt: null, photoCount: 0, updatedAt: '2026-11-09T12:00:00Z', ...over,
})

export const HARNESS_VISITS = {
  today: '2026-11-10',
  from: '2026-11-10',
  to: '2026-11-16',
  canEdit: true,
  crews: [{ id: 'sub-1', name: 'Green Team', hasPhoneLink: true, phone: '(850) 555-0101' }, { id: 'sub-2', name: 'Blue Team', hasPhoneLink: false, phone: null }],
  visits: [
    visit({ id: 'v1' }),
    visit({ id: 'v2', planName: 'Biweekly mowing', address: '88 Oak Ridge Rd, Crawfordville, FL 32327', routePosition: 5, status: 'completed', photoCount: 3, accessNotes: null }),
    visit({ id: 'v3', planName: 'Hedges', status: 'skipped', skipReason: 'rain', routePosition: null, accessNotes: null }),
    visit({ id: 'v4', planName: 'Roof & gutter care', step: 'inspection', stepLabel: 'Roof inspection', resultOptions: GYR, subId: null, subName: null, userId: 'u-insp', userName: 'Dana Inspector', scheduledDate: '2026-11-12', plannedDate: '2026-11-10', routePosition: null }),
    visit({ id: 'v5', scheduledDate: '2026-11-13', plannedDate: '2026-11-11', moved: true }),
  ],
}

export const HARNESS_CREW_DAY = [
  { id: 'v1', planName: 'Weekly mowing & edging', address: '2410 Crawfordville Hwy, Crawfordville, FL 32327', lat: 30.17, lng: -84.37, accessNotes: 'Gate code 4421. Dog in back yard.', status: 'scheduled', skipReason: null, photoCount: 0, routePosition: 1, resultOptions: [] },
  { id: 'v2', planName: 'Biweekly mowing', address: '88 Oak Ridge Rd, Crawfordville, FL 32327', lat: null, lng: null, accessNotes: null, status: 'completed', skipReason: null, photoCount: 2, routePosition: 2, resultOptions: [] },
  { id: 'v3', planName: 'Clean-up check — Hedges', address: '5 Old Shell Rd, Medart, FL 32327', lat: null, lng: null, accessNotes: null, status: 'scheduled', skipReason: null, photoCount: 0, routePosition: null, resultOptions: [{ key: 'pass', label: 'Passed', tone: 'good' }, { key: 'fail', label: 'Needs a return trip', tone: 'bad' }] },
]

/** Ready to bill (components/billing/ReadyToBill.tsx): October done, November waiting, one unpriced visit. */
const billUnit = (key: string, kind: 'visit' | 'month', customerId: string, propertyId: string, planName: string, month: string, date: string, cents: number, taxable: boolean, visits: string[]) => ({
  key, kind, customerId, propertyId, planId: `plan-${planName}`, planName, month, date, amountCents: cents, taxable, visits: visits.map((d, i) => ({ visitId: `${key}-${i}`, date: d })),
})
export const HARNESS_READY_TO_BILL = {
  today: '2026-11-11',
  currentMonth: '2026-11',
  lookbackDays: 120,
  maxPerRequest: 25,
  units: [
    billUnit('v:a1', 'visit', 'c1', 'p1', 'Weekly mowing', '2026-10', '2026-10-06', 4500, false, ['2026-10-06']),
    billUnit('v:a2', 'visit', 'c1', 'p1', 'Weekly mowing', '2026-10', '2026-10-13', 4500, false, ['2026-10-13']),
    billUnit('m:care:2026-10', 'month', 'c1', 'p1', 'Gutter care', '2026-10', '2026-10-01', 10000, true, ['2026-10-20']),
    billUnit('v:b1', 'visit', 'c2', 'p2', 'Weekly mowing', '2026-10', '2026-10-07', 4000, false, ['2026-10-07']),
    billUnit('v:a3', 'visit', 'c1', 'p1', 'Weekly mowing', '2026-11', '2026-11-03', 4500, false, ['2026-11-03']),
  ],
  notBillable: [{ visitId: 'z1', customerId: 'c2', planName: 'Shrub trim', date: '2026-10-09', reason: 'no_price' }],
  customers: { c1: { name: 'Pat Lee', email: 'pat@example.com', exempt: false }, c2: { name: 'Sam Ortiz', email: null, exempt: false } },
  addresses: { p1: '14 Oak Hollow Rd, Crawfordville', p2: '2 Elm St, Crawfordville' },
  salesTax: { enabled: true, rates: [{ id: 'fl', name: 'Florida', percent: 6, active: true }, { id: 'wak', name: 'Wakulla', percent: 1, active: true }], defaultRateIds: ['fl', 'wak'] },
}

export const HARNESS_CUSTOMER_INVOICES = {
  ready: true,
  customerEmail: 'pat@example.com',
  invoices: [
    { id: 'inv-1', job_id: null, customer_id: 'c1', invoice_number: 'INV-26-00012', invoice_kind: 'service', status: 'sent', issued_at: '2026-11-01', due_at: '2026-11-01', sent_at: '2026-11-01T14:00:00Z', sent_to_email: 'pat@example.com', subtotal_cents: 19000, tax_cents: 700, total_cents: 19700, applied_cents: 0, balance_cents: 19700, created_at: '2026-11-01T14:00:00Z' },
    { id: 'inv-2', job_id: null, customer_id: 'c1', invoice_number: 'INV-26-00004', invoice_kind: 'service', status: 'paid', issued_at: '2026-10-01', due_at: '2026-10-01', sent_at: '2026-10-01T14:00:00Z', sent_to_email: 'pat@example.com', subtotal_cents: 18000, tax_cents: 0, total_cents: 18000, applied_cents: 18000, balance_cents: 0, created_at: '2026-10-01T14:00:00Z' },
    { id: 'inv-3', job_id: null, customer_id: 'c1', invoice_number: 'INV-26-00015', invoice_kind: 'service', status: 'draft', issued_at: null, due_at: null, sent_at: null, sent_to_email: null, subtotal_cents: 4500, tax_cents: 0, total_cents: 4500, applied_cents: 0, balance_cents: 4500, created_at: '2026-11-10T14:00:00Z' },
  ],
}

// ---- Time clock (lib/time-tracking-db.ts ClockState / TimeWeek shapes) ----
const CLOCK_PEOPLE = [
  { userId: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Marcus Lead', isLead: true, open: null, onBreak: false, travelling: false },
  { userId: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Dee Crew', isLead: false, open: null, onBreak: false, travelling: false },
  { userId: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Tony Crew', isLead: false, open: null, onBreak: false, travelling: false },
]
export const HARNESS_CLOCK_STATE = {
  ready: true,
  people: CLOCK_PEOPLE,
  equipment: [],
  equipmentChoices: [{ id: 'cccccccc-0000-4000-8000-000000000001', name: 'Compact tractor' }],
  finishQuestions: [{ entryId: 'bbbbbbbb-0000-4000-8000-000000000001', userId: CLOCK_PEOPLE[1].userId, name: 'Dee Crew', day: '2026-11-09', startedAt: '2026-11-09T12:00:00.000Z', stoppedAt: '2026-11-09T17:30:00.000Z' }],
  captureLocation: false,
  timeZone: 'UTC',
}
export const HARNESS_CLOCK_STATE_IN = {
  ...HARNESS_CLOCK_STATE,
  finishQuestions: [],
  people: CLOCK_PEOPLE.map((p, i) => ({ ...p, open: { entryId: `bbbbbbbb-0000-4000-8000-00000000001${i}`, workOrderId: 'v1', jobId: null, startedAt: '2026-11-10T12:02:00.000Z' } })),
  equipment: [{ entryId: 'bbbbbbbb-0000-4000-8000-000000000020', name: 'Compact tractor', workOrderId: 'v1', startedAt: '2026-11-10T13:00:00.000Z' }],
}
export const HARNESS_JOB_CLOCK_SELF = {
  ...HARNESS_CLOCK_STATE,
  finishQuestions: [],
  equipmentChoices: [],
  people: [{ userId: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'Pat Office', isLead: false, open: null, onBreak: false, travelling: false }],
}
export const HARNESS_TIME_WEEK = {
  ready: true,
  weekStart: '2026-11-05',
  weekEnd: '2026-11-11',
  cutoffAt: '2026-11-12T04:59:59.999Z',
  editable: true,
  timeZone: 'UTC',
  staff: CLOCK_PEOPLE.map((p) => ({ userId: p.userId, name: p.name })),
  equipment: [{ id: 'eq1', kind: 'equipment', startedAt: '2026-11-10T13:00:00.000Z', endedAt: '2026-11-10T15:30:00.000Z', where: 'Grading — 5 Old Shell Rd', workOrderId: 'v3', jobId: null, source: 'lead_tap', endSource: 'lead_tap', needsReview: false, reviewNote: null, tappedBy: 'Marcus Lead', equipment: 'Compact tractor' }],
  people: [
    {
      userId: CLOCK_PEOPLE[1].userId,
      name: 'Dee Crew',
      paidSeconds: 31 * 3600 + 20 * 60,
      travelSeconds: 50 * 60,
      breakSeconds: 2 * 3600,
      regularHours: 31.333333,
      overtimeHours: 0,
      payrollHours: 31.33,
      typedHours: 30,
      warnings: [{ code: 'needs_review', day: '2026-11-09', text: 'Forgot to clock out — stopped at the last tap. Ask what time they finished.' }],
      entries: [
        { id: 'bbbbbbbb-0000-4000-8000-000000000001', kind: 'work', startedAt: '2026-11-09T12:00:00.000Z', endedAt: '2026-11-09T17:30:00.000Z', where: 'Weekly mowing — 2410 Crawfordville Hwy', workOrderId: 'v1', jobId: null, source: 'lead_tap', endSource: 'auto_closed', needsReview: true, reviewNote: 'Forgot to clock out — stopped at the last tap. Ask what time they finished.', tappedBy: 'Marcus Lead', equipment: null },
        { id: 'bbbbbbbb-0000-4000-8000-000000000002', kind: 'work', startedAt: '2026-11-10T12:02:00.000Z', endedAt: '2026-11-10T20:15:00.000Z', where: 'Job 26-0141', workOrderId: null, jobId: 'dddddddd-0000-4000-8000-000000000001', source: 'lead_tap', endSource: 'lead_tap', needsReview: false, reviewNote: null, tappedBy: 'Marcus Lead', equipment: null },
      ],
    },
    {
      userId: CLOCK_PEOPLE[0].userId,
      name: 'Marcus Lead',
      paidSeconds: 44 * 3600,
      travelSeconds: 0,
      breakSeconds: 0,
      regularHours: 40,
      overtimeHours: 4,
      payrollHours: null,
      typedHours: null,
      warnings: [{ code: 'no_break', day: '2026-11-10', text: '9 h with no break' }, { code: 'overtime', day: null, text: 'Overtime: 4 h' }],
      entries: [{ id: 'bbbbbbbb-0000-4000-8000-000000000003', kind: 'work', startedAt: '2026-11-10T11:00:00.000Z', endedAt: '2026-11-10T20:00:00.000Z', where: 'Job 26-0141', workOrderId: null, jobId: 'dddddddd-0000-4000-8000-000000000001', source: 'self_tap', endSource: 'self_tap', needsReview: false, reviewNote: null, tappedBy: 'Marcus Lead', equipment: null }],
    },
  ],
}
export const HARNESS_CREW_SETUP = {
  roster: { subId: 's1', name: 'Green Team', tracksTime: true, members: [{ userId: CLOCK_PEOPLE[0].userId, name: 'Marcus Lead', isLead: true }, { userId: CLOCK_PEOPLE[1].userId, name: 'Dee Crew', isLead: false }] },
  people: CLOCK_PEOPLE.map((p) => ({ userId: p.userId, name: p.name })),
}

// Move from Jobber (components/jobber-import/MoveFromJobber.tsx): a draft import that has been checked.
const JOBBER_COUNTS = { create: 0, update: 0, link: 0, skip: 0 }
export const HARNESS_JOBBER_RUN = {
  id: '11111111-2222-3333-4444-555555555555',
  status: 'draft',
  mapping: {},
  options: { dateOrder: null, trade: 'lawn', skipArchived: false },
  checked_at: '2026-11-11T15:00:00Z',
  created_at: '2026-11-11T14:00:00Z',
  finished_at: null,
  summary: {
    files: [{ id: 'f1', name: 'clients-1.csv', kind: 'clients', rows: 412 }],
    dateOrder: { order: 'mdy', ambiguous: true, conflicting: false, chosen: false },
    counts: {
      custom_field: { ...JOBBER_COUNTS, create: 4 },
      price_item: { ...JOBBER_COUNTS, create: 18 },
      customer: { ...JOBBER_COUNTS, create: 396, link: 12 },
      property: { ...JOBBER_COUNTS, create: 431 },
      plan: { ...JOBBER_COUNTS, create: 211 },
      invoice: { ...JOBBER_COUNTS, create: 1290 },
      history: { ...JOBBER_COUNTS, create: 77 },
    },
    newFields: [{ entity: 'customer', label: 'Gate code' }, { entity: 'customer', label: 'Tags' }, { entity: 'customer', label: 'Lead source' }, { entity: 'property', label: 'Mowing height' }],
    invoices: { open: 41, openBalanceCents: 1284500, paid: 1236, draft: 9, void: 4 },
    plans: { total: 211, fromVisits: 198, ended: 13 },
    duplicates: [{ reason: 'Already in your customers (same phone) — linked, only blank details filled', names: ['Jane Smith', 'J. Smith'] }],
    problems: [
      { severity: 'error', file: 'invoices.csv', row: 88, message: 'No total — left out' },
      { severity: 'warning', file: 'recurring.csv', row: 4, message: 'How often was worked out from 31 visits in Jobber — check it.' },
    ],
    problemCount: { errors: 1, warnings: 1 },
    nothingToImport: false,
  },
}
export const HARNESS_JOBBER_STATE = {
  run: HARNESS_JOBBER_RUN,
  files: [
    { id: 'f1', name: 'clients-1.csv', kind: 'clients', headers: ['J-ID', 'Display Name', 'E-mails', 'Mowing height'], row_count: 412, first_row: ['101_201', 'Jane Smith', 'jane@example.com', '3 inch'] },
    { id: 'f2', name: 'Recurring_jobs_report_2026-11-11.csv', kind: 'recurring_jobs', headers: ['Job #', 'Job title'], row_count: 211, first_row: ['7', 'Weekly lawn maintenance'] },
  ],
  progress: { total: 2444, pending: 2444, done: 0, failed: 0, skipped: 0, undone: 0, kept: 0 },
  trades: [{ slug: 'lawn', label: 'Lawn care' }, { slug: 'pressure_washing', label: 'Pressure washing' }],
  needsALook: [],
  reviewPlans: [],
}
export const HARNESS_JOBBER_DONE = {
  ...HARNESS_JOBBER_STATE,
  run: { ...HARNESS_JOBBER_RUN, status: 'done', finished_at: '2026-11-11T15:10:00Z' },
  progress: { total: 2444, pending: 0, done: 2440, failed: 4, skipped: 0, undone: 0, kept: 0 },
  needsALook: [{ id: 'i1', kind: 'invoice', label: 'Invoice #1088', status: 'failed', problems: [], error: 'Its customer wasn’t brought over', undo_note: null }],
  reviewPlans: [{ planId: 'p1', customerId: 'c1', name: 'Weekly lawn maintenance', review: ['How often was worked out from 31 visits in Jobber — check it.', 'Tax is off — turn it on if this service is taxable.'] }],
}

// Hours to bill (components/billing/HoursToBill.tsx): a grading job with two clocked days + a running one, a per-hour plan visit
// with no clock time, and a billed day whose invoice was voided.
const HB_LABOR = { itemId: 'pb-labor', name: 'Grading labor', rateCents: 6500, taxable: false }
export const HARNESS_HOURS_TO_BILL = {
  today: '2026-11-06',
  lookbackDays: 45,
  timeZone: 'UTC',
  settings: { rounding: 'up15', minimumHours: 2, travel: 'trip_charge', tripChargeItemId: 'pb-trip', basis: 'person', equipmentFromOperator: true },
  customers: { c1: { name: 'Pat Lee', email: 'pat@example.com', exempt: false }, c2: { name: 'Sam Ortiz', email: null, exempt: false } },
  equipment: [HB_LABOR, { itemId: 'pb-tractor', name: 'Tractor', rateCents: 9500, taxable: true }, { itemId: 'pb-skid', name: 'Skid steer', rateCents: 11000, taxable: true }],
  trip: { itemId: 'pb-trip', name: 'Trip charge', rateCents: 3500, taxable: false },
  salesTax: { enabled: true, rates: [{ id: 'fl', name: 'Florida', percent: 7, active: true }], defaultRateIds: ['fl'] },
  maxDaysPerApproval: 31,
  targets: [
    {
      key: 'job:j1', kind: 'job', id: 'dddddddd-0000-4000-8000-000000000001', title: 'Job 26-0141', customerId: 'c1', customerName: 'Pat Lee', address: '12 Oak St, Crawfordville',
      labor: HB_LABOR, estimatedHours: 20, billedHours: 6.5, visitDate: null, visitBilled: false,
      days: [
        { date: '2026-11-06', status: 'open', clockedSeconds: 0, lines: [], needsReview: false, approval: null },
        { date: '2026-11-04', status: 'ready', clockedSeconds: 22020, needsReview: true, approval: null, lines: [
          { kind: 'labor', itemId: 'pb-labor', name: 'Grading labor', people: 1, split: 'each', hours: 6.25, rateCents: 6500, taxable: false, reasons: ['Clocked 6 h 7 min (1 person), each person rounded up to the next 15 min'] },
          { kind: 'trip', itemId: 'pb-trip', name: 'Trip charge', people: null, hours: 1, rateCents: 3500, taxable: false, reasons: ['Flat trip charge per visit'] },
        ] },
        { date: '2026-11-03', status: 'ready', clockedSeconds: 42240, needsReview: false, approval: null, lines: [
          { kind: 'labor', itemId: 'pb-labor', name: 'Grading labor', people: 2, split: null, hours: 12, rateCents: 6500, taxable: false, reasons: ['Clocked 11 h 44 min (2 people), each person rounded up to the next 15 min'] },
          { kind: 'equipment', itemId: 'pb-tractor', name: 'Tractor', people: null, hours: 5.75, rateCents: 9500, taxable: true, reasons: ["Operator's time 5 h 37 min (machine ran 8 h), rounded up to the next 15 min"] },
          { kind: 'trip', itemId: 'pb-trip', name: 'Trip charge', people: null, hours: 1, rateCents: 3500, taxable: false, reasons: ['Flat trip charge per visit'] },
        ] },
        { date: '2026-10-30', status: 'voided', clockedSeconds: 23400, needsReview: false, lines: [
          { kind: 'labor', itemId: 'pb-labor', name: 'Grading labor', people: 1, split: 'each', hours: 6.5, rateCents: 6500, taxable: false, reasons: [] },
        ], approval: { id: 'ap1', date: '2026-10-30', source: 'edited', editReason: 'Clock left on over lunch', billableHours: 6.5, invoiceId: 'inv1', invoiceNumber: 'INV-26-26-0141-001', invoiceStatus: 'void' } },
      ],
    },
    {
      key: 'visit:v1', kind: 'visit', id: 'dddddddd-0000-4000-8000-000000000002', title: 'Bush hogging', customerId: 'c2', customerName: 'Sam Ortiz', address: '4 Pine Rd',
      labor: { itemId: null, name: 'Bush hogging', rateCents: 7500, taxable: false }, estimatedHours: null, billedHours: 0, visitDate: '2026-11-05', visitBilled: false,
      days: [{ date: '2026-11-05', status: 'no_time', clockedSeconds: 0, lines: [], needsReview: false, approval: null }],
    },
  ],
}

export const HARNESS_JOB_HOURLY = {
  mode: 'fixed',
  estimatedHours: null,
  rateItemId: null,
  rateChoices: [
    { id: 'pb-labor', name: 'Grading labor', rateCents: 6500, isLabor: true },
    { id: 'pb-tractor', name: 'Tractor', rateCents: 9500, isLabor: false },
  ],
  fromQuote: { estimatedHours: 20, rateItemId: 'pb-labor', lines: [{ name: 'Grading labor', hours: 20 }, { name: 'Tractor', hours: 8 }] },
  billedHours: 0,
  canEdit: true,
  canBill: true,
}

export const HARNESS_HOURLY_SETTINGS = {
  settings: { rounding: 'up15', minimumHours: 2, travel: 'trip_charge', tripChargeItemId: 'pb-trip', basis: 'person', equipmentFromOperator: true },
  tripChoices: [{ id: 'pb-trip', name: 'Trip charge', rateCents: 3500 }],
}

// Purchase orders (components/ops/PurchaseOrdersCard.tsx)
export const PO_VENDORS = [
  { id: 'pv1', name: 'Gravel Guys Hauling', vendorType: 'sub', email: 'orders@gravelguys-hauling.example.test', phone: null, trades: ['hauling'], connectionType: 'email', lastUsedAt: '2026-11-01T12:00:00Z' },
  { id: 'pv2', name: 'Concord Lumber Supply', vendorType: 'supplier', email: 'orders@concord-lumber.example.test', phone: null, trades: [], connectionType: 'email', lastUsedAt: null },
]
const PO_LINE = { id: 'pl1', position: 0, description: 'Dumpster haul-off, 30 yd', quantity: 2, unit: 'ea', unitCostCents: 45000, costType: 'dump', costCode: null, pricebookItemId: null, receivedQuantity: 0 }
export const PO_LIST = {
  orders: [
    {
      id: 'po1', kind: 'general', vendorId: 'pv1', vendorName: 'Gravel Guys Hauling', vendorType: 'sub', poNumber: '26-0042-B', revision: 0, label: '26-0042-B', status: 'sent', title: null,
      date: '2026-11-20', dateKind: 'start', address: '12 Elm Street, Concord NC 28025', note: null, jobId: 'job-1', workOrderId: null, lines: [PO_LINE], totalCents: 90000, billedCents: 0, bills: [],
      firstSentAt: '2026-11-10T12:00:00Z', lastSentAt: '2026-11-10T12:00:00Z', lastSentTo: 'orders@gravelguys-hauling.example.test', acknowledgedAt: null, acknowledgedBy: null, receivedAt: null, changedSinceSent: false,
    },
  ],
  vendors: PO_VENDORS,
  canEdit: true, canBill: true, showMoney: true,
  target: { reference: '26-0042', address: '12 Elm Street, Concord NC 28025', scheduledDate: '2026-11-20', cancelled: false, jobId: 'job-1', workOrderId: null },
}
export const PO_PREVIEW = {
  preview: {
    vendorName: 'Concord Lumber Supply', kind: 'order', poLabel: '26-0042-C', to: 'orders@concord-lumber.example.test', cc: ['crm@green.example.test'], subject: 'Purchase order 26-0042-C',
    body: 'Hi Concord Lumber Supply,\n\nPlease see the attached purchase order 26-0042-C for job 26-0042.\n\nPlease confirm you have it: https://crm.example.test/po/abc', changes: [], totalCents: 12000, lineCount: 1,
    confirmMessage: null, blockers: [], previewToken: 'tok', sendButtonLabel: 'Send to Concord Lumber Supply', hasPdf: true,
  },
}
export const PO_DRAFT_SAVED = { ok: true, id: 'po2', created: true }

/* ---- Project tools (budget, selections, schedule, daily log) ---- */
export const HARNESS_BUDGET = {
  ready: true,
  canEdit: true,
  codes: [
    { code: 'materials', label: 'Materials', costType: 'material', active: true },
    { code: 'labor', label: 'Labor', costType: 'labor', active: true },
    { code: 'sub', label: 'Sub', costType: 'subcontractor', active: true },
    { code: 'permit', label: 'Permit', costType: 'permit', active: true },
    { code: 'dump', label: 'Dump', costType: 'other', active: true },
    { code: 'equipment', label: 'Equipment', costType: 'other', active: true },
    { code: 'other', label: 'Other', costType: 'other', active: true },
  ],
  view: {
    rows: [
      { code: 'materials', label: 'Materials', budget: 42000, actual: 31000, variance: 11000, state: 'under', active: true },
      { code: 'labor', label: 'Labor', budget: 18000, actual: 17100, variance: 900, state: 'near', active: true },
      { code: 'sub', label: 'Sub', budget: 30000, actual: 33500, variance: -3500, state: 'over', active: true },
      { code: 'permit', label: 'Permit', budget: null, actual: 850, variance: null, state: 'none', active: true },
    ],
    totalBudget: 90000,
    totalActual: 82450,
    totalVariance: 7550,
    state: 'near',
  },
  history: [{ id: 'h1', cost_code: 'sub', old_amount: 28000, new_amount: 30000, reason: 'Added the retaining wall', changed_at: '2026-11-09T15:00:00Z', changed_by_name: 'Nathan Hall' }],
}

export const HARNESS_SELECTIONS = {
  ready: true,
  canEdit: true,
  repName: 'Nathan Hall',
  selections: [
    { id: 's1', item: 'Kitchen faucet', allowance: 500, options: [{ id: 'o1', label: 'Brushed nickel', price: 450 }, { id: 'o2', label: 'Matte black', price: 750 }], chosen_option_id: null, chosen_label: null, chosen_price: null, difference: null, due_date: '2026-11-20', status: 'sent', state: 'waiting_customer', link: 'https://acme.example.test/s/abcdefghijklmnopqrstuvwx', change_order_number: null, change_order_url: null, chosen_by_name: null, chosen_source: null, needs_attention: false },
    { id: 's2', item: 'Master bath tile', allowance: 3200, options: [{ id: 'o3', label: 'Porcelain 12x24', price: 4100 }], chosen_option_id: 'o3', chosen_label: 'Porcelain 12x24', chosen_price: 4100, difference: 900, due_date: null, status: 'chosen', state: 'waiting_signature', link: null, change_order_number: 'CO-002', change_order_url: 'https://acme.example.test/change-orders/sign/tok', chosen_by_name: 'Pat Lee', chosen_source: 'customer', needs_attention: false },
    { id: 's3', item: 'Front door', allowance: 1800, options: [{ id: 'o4', label: 'Fiberglass', price: 1650 }], chosen_option_id: 'o4', chosen_label: 'Fiberglass', chosen_price: 1650, difference: -150, due_date: null, status: 'chosen', state: 'approved', link: null, change_order_number: null, change_order_url: null, chosen_by_name: 'Pat Lee', chosen_source: 'customer', needs_attention: false },
    { id: 's4', item: 'Interior paint', allowance: 2400, options: [{ id: 'o5', label: 'Sherwin-Williams', price: 2400 }], chosen_option_id: null, chosen_label: null, chosen_price: null, difference: null, due_date: '2026-11-01', status: 'draft', state: 'overdue', link: null, change_order_number: null, change_order_url: null, chosen_by_name: null, chosen_source: null, needs_attention: false },
    { id: 's5', item: 'Cabinet pulls', allowance: 300, options: [{ id: 'o6', label: 'Black iron', price: 540 }], chosen_option_id: 'o6', chosen_label: 'Black iron', chosen_price: 540, difference: 240, due_date: null, status: 'chosen', state: 'waiting_signature', link: null, change_order_number: 'CO-003', change_order_url: null, chosen_by_name: 'Pat Lee', chosen_source: 'customer', needs_attention: true },
  ],
}

const stage = (id: string, key: string, name: string, start: string, workdays: number, dependsOn: string[], extra: Record<string, unknown> = {}) => ({ id, key, name, trade: null, start, workdays, dependsOn, doneAt: null, end: start, tradeName: null, bookedDate: null, bookedStatus: null, ...extra })
export const HARNESS_SCHEDULE = {
  ready: true,
  canEdit: true,
  templates: [{ id: 'new_home', label: 'New home build', stageCount: 13 }],
  stages: [
    stage('g1', 'permits', 'Permits', '2026-11-02', 10, [], { doneAt: '2026-11-13T00:00:00Z' }),
    stage('g2', 'site_work', 'Site work', '2026-11-16', 5, ['permits'], { tradeName: 'Site work', bookedDate: '2026-11-16', bookedStatus: 'scheduled' }),
    stage('g3', 'foundation', 'Foundation', '2026-11-23', 7, ['site_work'], { tradeName: 'Foundation' }),
    stage('g4', 'framing', 'Framing', '2026-12-02', 15, ['foundation']),
  ],
}
export const HARNESS_SCHEDULE_EMPTY = { ...HARNESS_SCHEDULE, stages: [] }

export const HARNESS_DAILY_LOGS = {
  ready: true,
  logs: [
    { id: 'd1', log_date: '2026-11-10', note: 'Framing crew finished the second-floor deck. Rain stopped work at 2.', weather: 'Light rain, 48°F, wind 8 mph', photo_ids: ['p1', 'p2'], author_name: 'Nathan Hall', source: 'staff', summary_sent_at: null, created_at: '2026-11-10T20:00:00Z' },
    { id: 'd2', log_date: '2026-11-09', note: 'Delivered trusses.', weather: 'Sunny, 61°F', photo_ids: [], author_name: 'Crew', source: 'crew', summary_sent_at: '2026-11-09T22:00:00Z', created_at: '2026-11-09T21:00:00Z' },
  ],
}

export const HARNESS_PUBLIC_SELECTION = {
  state: 'open',
  company: { name: 'Acme Builders', phone: '(555) 010-2030', email: 'office@acme.example.test', logoHref: null },
  item: 'Kitchen faucet',
  allowance: 500,
  dueDate: '2026-11-20',
  options: [{ id: 'o1', label: 'Brushed nickel', price: 450 }, { id: 'o2', label: 'Matte black', price: 750 }],
  chosenLabel: null,
  signingUrl: null,
}
