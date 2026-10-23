import {
  appointmentNeedsOutcome,
  appointmentOutcomeHref,
  contractTotalForJob,
  expectedCommissionBase,
  evaluateAppointmentHealth,
  evaluateJobHealth,
  shapeNeedsYou,
  isCollectedForced,
  isJobPayable,
  loadDataHealth,
  payabilityFromProblems,
  type JobHealthInput,
} from '@/lib/data-health'
import { buildNeedsYouHtml } from '@/lib/morning-update-email'

const TODAY = '2026-10-21'

function input(patch: Omit<Partial<JobHealthInput>, 'job'> & { job?: Partial<JobHealthInput['job']> } = {}): JobHealthInput {
  const { job, ...rest } = patch
  return {
    job: {
      id: 'job-1',
      job_number: '26-0050',
      status: 'collected',
      sale_amount: 10000,
      commission_comp_base: 10000,
      salesperson_id: 'closer-1',
      scheduled_date: '2026-10-01',
      materials_status: 'ordered',
      permit_required: false,
      permit_status: 'not_needed',
      allow_close_with_balance: false,
      close_balance_reason: null,
      ...job,
    },
    contractTotal: 10000,
    changeOrderDelta: 0,
    commissionableChangeOrderDelta: 0,
    paidCents: 1_000_000,
    costLineCount: 2,
    deal: { owner_user_id: 'closer-1', setter_user_id: 'setter-1', is_self_generated: false },
    trades: [{ status: 'completed' }],
    todayYmd: TODAY,
    ...rest,
  }
}

const codes = (i: JobHealthInput) => evaluateJobHealth(i).map((p) => p.code)

describe('evaluateJobHealth', () => {
  it('a clean, paid, costed, credited job has no problems', () => {
    expect(codes(input())).toEqual([])
  })

  it('cancelled jobs are never listed', () => {
    expect(codes(input({ job: { status: 'cancelled', commission_comp_base: null } }))).toEqual([])
  })

  it('flags a missing commission base and says what it should be', () => {
    const problems = evaluateJobHealth(input({ job: { commission_comp_base: null } }))
    expect(problems[0].code).toBe('missing_commission_base')
    expect(problems[0].message).toContain('$10,000.00')
    expect(problems[0].blocksPay).toBe(true)
  })

  it('base must equal agreement + commissionable change orders (±$0.05)', () => {
    const co = { changeOrderDelta: 1395.2, commissionableChangeOrderDelta: 1395.2, paidCents: 1_139_520 }
    expect(codes(input({ ...co, job: { commission_comp_base: 11395.2, sale_amount: 11395.2 } }))).toEqual([])
    expect(codes(input({ ...co, job: { commission_comp_base: 11395.24, sale_amount: 11395.2 } }))).toEqual([])
    expect(codes(input({ ...co, job: { commission_comp_base: 10000, sale_amount: 11395.2 } }))).toEqual(['commission_base_mismatch'])
  })

  it('a non-commissionable change order moves the sale, not the base', () => {
    const i = input({
      changeOrderDelta: 500,
      commissionableChangeOrderDelta: 0,
      paidCents: 1_050_000,
      job: { sale_amount: 10500, commission_comp_base: 10000 },
    })
    expect(codes(i)).toEqual([])
  })

  it('flags a sale amount that disagrees with agreement + change orders', () => {
    const i = input({ job: { sale_amount: 14457.84, commission_comp_base: 9457.84 }, contractTotal: 9457.84, paidCents: 1_445_784 })
    expect(codes(i)).toEqual(['sale_amount_mismatch'])
  })

  it('no signed agreement holds pay', () => {
    const problems = evaluateJobHealth(input({ contractTotal: null }))
    expect(problems.map((p) => p.code)).toEqual(['no_signed_contract'])
    expect(problems[0].blocksPay).toBe(true)
  })

  describe('collected vs payments (±$0.05)', () => {
    it('a collected job 5 cents short is paid in full', () => {
      expect(codes(input({ paidCents: 999_995 }))).toEqual([])
    })
    it('a collected job 6 cents short is flagged', () => {
      expect(codes(input({ paidCents: 999_994 }))).toEqual(['collected_but_short'])
    })
    it('a short job forced through WITH a reason is accepted', () => {
      expect(codes(input({ paidCents: 900_000, job: { allow_close_with_balance: true, close_balance_reason: 'Customer discount' } }))).toEqual([])
    })
    it('a bare close-with-balance checkbox with no reason is not a force', () => {
      expect(codes(input({ paidCents: 900_000, job: { allow_close_with_balance: true, close_balance_reason: '  ' } }))).toEqual([
        'collected_but_short',
      ])
    })
    it('honors a super-admin force column when it exists', () => {
      expect(codes(input({ paidCents: 900_000, job: { collected_forced_at: '2026-10-20T00:00:00Z' } }))).toEqual([])
      expect(codes(input({ paidCents: 900_000, job: { collected_force_reason: 'Owner write-off' } }))).toEqual([])
      expect(codes(input({ paidCents: 900_000, job: { collected_forced_at: null } }))).toEqual(['collected_but_short'])
      // After the money-inputs migration only a super-admin stamp (close_balance_by) counts.
      expect(
        codes(input({ paidCents: 900_000, job: { allow_close_with_balance: true, close_balance_reason: null, close_balance_by: 'owner-1' } }))
      ).toEqual([])
      expect(
        codes(input({ paidCents: 900_000, job: { allow_close_with_balance: true, close_balance_reason: 'old ack', close_balance_by: null } }))
      ).toEqual(['collected_but_short'])
    })
    it('a complete job paid in full should be marked collected (does not hold pay)', () => {
      const problems = evaluateJobHealth(input({ job: { status: 'complete' } }))
      expect(problems.map((p) => p.code)).toEqual(['paid_not_marked_collected'])
      expect(problems[0].blocksPay).toBe(false)
    })
  })

  it('isCollectedForced ignores unrelated columns', () => {
    expect(isCollectedForced({ id: 'x', job_number: '1', status: 'collected', enforcement_note: 'yes' })).toBe(false)
  })

  it('done with no cost lines holds pay', () => {
    expect(codes(input({ costLineCount: 0 }))).toEqual(['completed_no_costs'])
    expect(codes(input({ costLineCount: 0, job: { status: 'sold', scheduled_date: null }, paidCents: 0 }))).toEqual([])
  })

  describe('sale credit', () => {
    it('no closer anywhere', () => {
      expect(codes(input({ job: { salesperson_id: null }, deal: { owner_user_id: null, setter_user_id: 's', is_self_generated: false } }))).toEqual([
        'no_closer',
      ])
    })
    it('no setter on a deal not marked self-generated', () => {
      expect(codes(input({ deal: { owner_user_id: 'c', setter_user_id: null, is_self_generated: false } }))).toEqual(['no_setter'])
      expect(codes(input({ deal: { owner_user_id: 'c', setter_user_id: null, is_self_generated: true } }))).toEqual([])
    })
    it('self-generated with a different setter conflicts', () => {
      expect(codes(input({ deal: { owner_user_id: 'c', setter_user_id: 's', is_self_generated: true } }))).toEqual([
        'self_gen_setter_conflict',
      ])
    })
    it('no deal linked', () => {
      expect(codes(input({ deal: null }))).toEqual(['no_deal_linked'])
    })
  })

  describe('ops', () => {
    const open = { status: 'scheduled', paidCents: 0, costLineCount: 0 }
    it('materials not ordered within 3 days of the crew', () => {
      expect(codes(input({ paidCents: 0, job: { ...open, scheduled_date: '2026-10-24', materials_status: 'not_ordered' } }))).toContain(
        'materials_not_ordered'
      )
      expect(codes(input({ paidCents: 0, job: { ...open, scheduled_date: '2026-10-25', materials_status: 'not_ordered' } }))).not.toContain(
        'materials_not_ordered'
      )
      expect(codes(input({ paidCents: 0, job: { ...open, scheduled_date: '2026-10-22', materials_status: 'ordered' } }))).not.toContain(
        'materials_not_ordered'
      )
    })
    it('permit still pending at install', () => {
      const i = input({ paidCents: 0, job: { ...open, scheduled_date: '2026-10-22', permit_required: true, permit_status: 'pending' } })
      expect(codes(i)).toContain('permit_pending')
    })
    it('every crew done but the job still open', () => {
      expect(codes(input({ paidCents: 0, job: { status: 'in_progress' }, trades: [{ status: 'completed' }, { status: 'cancelled' }] }))).toContain(
        'crews_done_job_open'
      )
      expect(codes(input({ paidCents: 0, job: { status: 'in_progress' }, trades: [{ status: 'completed' }, { status: 'scheduled' }] }))).not.toContain(
        'crews_done_job_open'
      )
    })
  })
})

describe('appointments', () => {
  const now = new Date('2026-10-21T18:00:00Z')
  const appt = { id: 'a1', status: 'scheduled', scheduled_for: '2026-10-21T14:00:00Z', duration_minutes: 60, lead_id: 'l1', opportunity_id: 'o1' }

  it('needs an outcome 2 hours after it was due to end', () => {
    expect(appointmentNeedsOutcome(appt, now)).toBe(true)
    expect(appointmentNeedsOutcome({ ...appt, scheduled_for: '2026-10-21T15:30:00Z' }, now)).toBe(false)
    expect(appointmentNeedsOutcome({ ...appt, status: 'completed' }, now)).toBe(false)
  })

  it('links to where the outcome is logged', () => {
    expect(appointmentOutcomeHref(appt)).toBe('/appointments/feedback?id=a1&lead_id=l1')
    expect(appointmentOutcomeHref({ ...appt, appointment_type: 'close' })).toBe('/opportunities/o1')
    expect(evaluateAppointmentHealth(appt, now)[0].fixLabel).toBe('Log outcome')
  })
})

describe('payability', () => {
  it('ok only when installed and nothing blocks pay', () => {
    expect(payabilityFromProblems({ status: 'collected' }, [])).toEqual({ ok: true, reasons: [] })
    expect(payabilityFromProblems({ status: 'in_progress' }, []).ok).toBe(false)
    const nonBlocking = evaluateJobHealth(input({ job: { status: 'complete' } }))
    expect(payabilityFromProblems({ status: 'complete' }, nonBlocking).ok).toBe(true)
    const blocking = evaluateJobHealth(input({ costLineCount: 0 }))
    expect(payabilityFromProblems({ status: 'collected' }, blocking)).toEqual({
      ok: false,
      reasons: ['Job is done but has no costs entered (labor, materials).'],
    })
  })
})

describe('contractTotalForJob', () => {
  // One agreement on the proposal, a second (finance) on the deal only: both count, each once.
  const onProposal = { opportunity_id: 'o1', proposal_id: 'p1', project_cost: '5000.10' }
  const onDealOnly = { opportunity_id: 'o1', proposal_id: null, project_cost: 3000 }
  const byProposal = new Map([['p1', [onProposal]]])
  const byOpp = new Map([['o1', [onDealOnly, onProposal]]])

  it('SUMS every completed agreement however it links (split cash/finance deals), each once', () => {
    expect(contractTotalForJob({ proposalId: 'p1', opportunityId: 'o1' }, byProposal, byOpp)).toBe(8000.1)
    expect(contractTotalForJob({ proposalId: null, opportunityId: 'o1' }, byProposal, byOpp)).toBe(8000.1)
    expect(contractTotalForJob({ proposalId: 'p1', opportunityId: null }, byProposal, byOpp)).toBe(5000.1)
    expect(contractTotalForJob({ proposalId: 'px', opportunityId: null }, byProposal, byOpp)).toBeNull()
  })
})

describe('expected commission base excludes sales tax (same rule as lib/job-commission-base.ts)', () => {
  it('contract + commissionable change orders − sales tax; dealer fees never matter', () => {
    expect(expectedCommissionBase({ contractTotal: 11280, commissionableChangeOrderDelta: 0, salesTax: 615.04 })).toBe(10664.96)
    expect(expectedCommissionBase({ contractTotal: 10000, commissionableChangeOrderDelta: 500, salesTax: 0 })).toBe(10500)
    expect(expectedCommissionBase({ contractTotal: 10000, commissionableChangeOrderDelta: 500 })).toBe(10500)
    expect(expectedCommissionBase({ contractTotal: null, commissionableChangeOrderDelta: 0, salesTax: 5 })).toBeNull()
  })
  it('a base that already excludes the tax is NOT a mismatch', () => {
    const problems = evaluateJobHealth({
      job: { id: 'j', job_number: '26-1', status: 'collected', sale_amount: 11280, commission_comp_base: 10664.96 } as never,
      contractTotal: 11280, changeOrderDelta: 0, commissionableChangeOrderDelta: 0, salesTax: 615.04,
      paidCents: 1_128_000, costLineCount: 1, deal: { owner_user_id: 'c', setter_user_id: 's' }, trades: [], todayYmd: '2026-10-21',
    })
    expect(problems.map((p) => p.code)).not.toContain('commission_base_mismatch')
  })
})

describe('jobs settled outside the CRM', () => {
  it('are never in Needs you', async () => {
    const t = { ...tables, production_jobs: tables.production_jobs.map((j) => (j.id === 'j2' ? { ...j, payroll_settled_externally_at: '2026-10-25T12:00:00Z', settled_externally_reason: 'paid outside CRM before cutover' } : j)) }
    const report = await loadDataHealth(fakeSupabase(t), 'org-1', { now: new Date('2026-10-21T12:00:00Z') })
    expect(report.jobs.map((j) => j.jobNumber)).toEqual([])
  })
})

/* ---------------- loader, against a tiny in-memory Supabase ---------------- */

type Row = Record<string, unknown>
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      const builder: Record<string, unknown> = {}
      const chain = (fn: (r: Row[]) => Row[]) => {
        rows = fn(rows)
        return builder
      }
      Object.assign(builder, {
        select: () => builder,
        order: () => builder,
        eq: (c: string, v: unknown) => chain((r) => r.filter((x) => x[c] === v)),
        neq: (c: string, v: unknown) => chain((r) => r.filter((x) => x[c] !== v)),
        in: (c: string, v: unknown[]) => chain((r) => r.filter((x) => v.includes(x[c]))),
        is: (c: string, v: unknown) => chain((r) => r.filter((x) => (x[c] ?? null) === v)),
        not: (c: string, _op: string, v: unknown) => chain((r) => r.filter((x) => (x[c] ?? null) !== v)),
        lt: (c: string, v: string) => chain((r) => r.filter((x) => String(x[c]) < v)),
        lte: (c: string, v: string) => chain((r) => r.filter((x) => String(x[c]) <= v)),
        gte: (c: string, v: string) => chain((r) => r.filter((x) => String(x[c]) >= v)),
        limit: () => builder,
        range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      })
      return builder
    },
  } as never
}

const ORG = 'org-1'
const tables = {
  production_jobs: [
    {
      id: 'j1', org_id: ORG, job_number: '26-0001', status: 'collected', project_id: 'pr1', sale_amount: 1000,
      commission_comp_base: 1000, salesperson_id: 'c', address_text: '1 Main', accepted_proposal_id: null, linked_proposal_id: null,
    },
    {
      id: 'j2', org_id: ORG, job_number: '26-0002', status: 'collected', project_id: 'pr2', sale_amount: 2000,
      commission_comp_base: null, salesperson_id: 'c', address_text: '2 Main', accepted_proposal_id: null, linked_proposal_id: null,
    },
    { id: 'j3', org_id: ORG, job_number: '26-0003', status: 'cancelled', project_id: null, sale_amount: 5 },
    { id: 'jx', org_id: 'other-org', job_number: '99-0001', status: 'collected', project_id: null },
  ],
  projects: [
    { id: 'pr1', org_id: ORG, opportunity_id: 'o1' },
    { id: 'pr2', org_id: ORG, opportunity_id: 'o2' },
  ],
  opportunities: [
    { id: 'o1', org_id: ORG, owner_user_id: 'c', setter_user_id: 's', is_self_generated: false },
    { id: 'o2', org_id: ORG, owner_user_id: 'c', setter_user_id: 's', is_self_generated: false },
  ],
  order_form_contracts: [
    { org_id: ORG, status: 'completed', agreement_type: 'installation', opportunity_id: 'o1', proposal_id: null, project_cost: 1000 },
    { org_id: ORG, status: 'completed', agreement_type: 'installation', opportunity_id: 'o2', proposal_id: null, project_cost: 2000 },
    { org_id: ORG, status: 'voided', agreement_type: 'installation', opportunity_id: 'o2', proposal_id: null, project_cost: 9999 },
  ],
  job_change_orders: [],
  job_payments: [
    { job_id: 'j1', amount_cents: 100_000, funding_status: 'cleared' },
    { job_id: 'j2', amount_cents: 150_000, funding_status: 'cleared' },
    { job_id: 'j2', amount_cents: 50_000, funding_status: 'pending' },
  ],
  job_cost_lines: [
    { job_id: 'j1', org_id: ORG, deleted_at: null },
    { job_id: 'j2', org_id: ORG, deleted_at: null },
  ],
  work_orders: [],
  scheduled_appointments: [
    { id: 'a1', org_id: ORG, status: 'scheduled', scheduled_for: '2026-10-01T14:00:00.000Z', duration_minutes: 60, appointment_type: 'inspection', lead_id: 'l1' },
    { id: 'a2', org_id: ORG, status: 'completed', scheduled_for: '2026-10-01T14:00:00.000Z', duration_minutes: 60 },
  ],
}

describe('loadDataHealth', () => {
  const now = new Date('2026-10-21T12:00:00Z')

  it('lists only flagged, non-cancelled jobs in the org, plus past appointments', async () => {
    const report = await loadDataHealth(fakeSupabase(tables), ORG, { now })
    expect(report.jobs.map((j) => j.jobNumber)).toEqual(['26-0002'])
    // A pending payment does not count: 1,500 of 2,000 received.
    expect(report.jobs[0].problems.map((p) => p.code)).toEqual(['missing_commission_base', 'collected_but_short'])
    expect(report.appointments.map((a) => a.appointmentId)).toEqual(['a1'])
    expect(report.count).toBe(2)
  })

  it('hides money rows from ops (see needs-you-roles.test.ts for the full role matrix)', async () => {
    const report = await loadDataHealth(fakeSupabase(tables), ORG, { now })
    const filtered = shapeNeedsYou(report, 'ops')!
    expect(filtered.jobs).toEqual([])
    expect(filtered.count).toBe(1)
  })

  it('isJobPayable answers per job', async () => {
    expect(await isJobPayable(fakeSupabase(tables), 'j1', { now })).toEqual({ ok: true, reasons: [] })
    const j2 = await isJobPayable(fakeSupabase(tables), 'j2', { now })
    expect(j2.ok).toBe(false)
    expect(j2.reasons).toHaveLength(2)
    expect(await isJobPayable(fakeSupabase(tables), 'jx', { orgId: ORG, now })).toEqual({ ok: false, reasons: ['Job not found.'] })
  })

  it('renders into the morning email without customer details', async () => {
    const report = await loadDataHealth(fakeSupabase(tables), ORG, { now })
    const html = buildNeedsYouHtml(report, 'https://crm.example')
    expect(html).toContain('Needs you (2)')
    expect(html).toContain('Job 26-0002')
    expect(html).toContain('https://crm.example/ops/jobs/j2#payments-section')
    expect(html).toContain('1 past appointment with no outcome')
    expect(html).not.toContain('2 Main')
    expect(buildNeedsYouHtml({ generatedAt: '', jobs: [], appointments: [], count: 0 })).toContain('All clear')
  })
})
