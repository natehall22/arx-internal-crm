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
    { id: 'a1', title: '12 Elm Street, Concord NC 28025', detail: '3:30 PM', href: '#' },
    { id: 'a2', title: '4400 Very Long Boulevard Name Suite 200, Mooresville NC 28117', detail: '5:00 PM', href: '#' },
  ] },
  { id: 'outcomes-to-log', title: 'Outcomes to log', count: 0, empty: 'Every past appointment has an outcome.', items: [] },
  { id: 'unsigned-proposals', title: 'Proposals waiting for a signature', count: 9, empty: 'Nothing waiting on a customer.', items: [
    { id: 'p1', title: 'Ashley Gaines', detail: '#P-00118 · $18,430.50', href: '#' },
  ] },
]

/** Fictional week for the Pay-this-week screen (names, jobs and amounts are made up). */
export const PAY_WEEK = {
  period: { id: '00000000-0000-4000-8000-000000000001', label: 'Week ending 2026-10-21', cutoffAt: '2026-10-22T03:59:59.999Z', payDate: '2026-10-23', status: 'open', weekStart: '2026-10-15', weekEnding: '2026-10-21' },
  state: 'draft',
  totals: { amount: 5238.5, people: 5 },
  needs: [
    { kind: 'hours', userId: 'u-avery', name: 'Avery Lin', rate: 18 },
    { kind: 'bonus', id: 'b1', userId: 'u-riley', name: 'Riley Moss', amount: 250, what: 'Setter ramp bonus — 4 appointments set in first 30 days' },
    { kind: 'plans', text: '2 people have no pay plan, so they are paid nothing', names: ['Cam Hill', 'Tim Joyce'], href: '/admin/comp-plans' },
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

export const MY_PAY = {
  name: 'Jordan Vale',
  headline: { amount: 2394, state: 'draft', payDate: '2026-10-23' },
  thisWeek: [
    { key: 't1', title: '26-0141 · 12 Example Maple Ln', why: "On Friday's check (2026-10-23).", amount: 1288, math: '$18,400 × 7% closer = $1,288', jobId: 'j1', lineKind: 'Commission' },
    { key: 't2', title: '26-0144 · 408 Sample Birch Ct, a very long address that has to wrap on a phone', why: "On Friday's check (2026-10-23).", amount: 882, math: '$12,600 × 7% closer = $882', jobId: 'j2', lineKind: 'Commission' },
    { key: 't3', title: '26-0129 · 19 Imaginary Elm Ave', why: "On Friday's check (2026-10-23).", amount: 224, math: '$9,200 × 7% closer = $644, reduced to $224 to stay inside the 18% pool', jobId: 'j3', lineKind: 'Commission' },
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
  { id: 'j1', jobNumber: '26-0041', lastName: 'Gaines', customerName: 'Ashley Gaines', address: '1423 Maple Ridge Dr, Concord NC', saleDate: '2026-10-01', saleAmount: 18400, financeCost: 0, commissionable: 18400, materials: 6100, labor: 4060, misc: 0, totalExpenses: 10160, setter: 920, closer: 1288, sales: 1104, opp: 1656, grossProfit: 5480, grossPercent: 29.78, ownerDraw: 1096, perOwner: 274, netProfit: 4384, netPercent: 23.8, notes: 'Dumpster on the street', status: 'Deposit Received', unreviewed: true },
  { id: 'j2', jobNumber: '26-0038', lastName: 'Cox', customerName: 'Bill Cox', address: '88 Oak Ave, Kannapolis NC', saleDate: '2026-09-12', saleAmount: 16325, financeCost: 900, commissionable: 15425, materials: 5200, labor: 4060, misc: 200, totalExpenses: 9460, setter: 771, closer: 1080, sales: 925, opp: 1469, grossProfit: 2410, grossPercent: 14.8, ownerDraw: 482, perOwner: 120, netProfit: 1928, netPercent: 11.8, notes: null, status: 'Reconciled & Closed', unreviewed: false },
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
