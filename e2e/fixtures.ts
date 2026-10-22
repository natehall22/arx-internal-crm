import type { DataHealthReport } from '../lib/data-health'

const problem = (code: string, area: string, message: string, fixLabel: string) => ({
  code, area, message, fixLabel, fixHref: '/ops/jobs/job-1', blocksPay: area === 'money' || area === 'credit',
})

export const HARNESS_NEEDS_YOU = {
  generatedAt: '2026-10-22T12:00:00Z',
  count: 3,
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

export const PAYROLL_PERIODS = {
  periods: [
    { id: 'p1', period_label: '2026-W42', cutoff_at: '2026-10-17T23:59:59Z', lock_at: '2026-10-19T12:00:00Z', scheduled_pay_date: '2026-10-23', status: 'open', locked_at: null, paid_at: null },
    { id: 'p2', period_label: '2026-W41', cutoff_at: '2026-10-10T23:59:59Z', lock_at: '2026-10-12T12:00:00Z', scheduled_pay_date: '2026-10-16', status: 'locked', locked_at: '2026-10-12T12:00:00Z', paid_at: null },
  ],
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
