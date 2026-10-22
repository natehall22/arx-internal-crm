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
