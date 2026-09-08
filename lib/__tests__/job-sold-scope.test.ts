import { buildJobSoldScope } from '@/lib/job-sold-scope'

/**
 * Regression cover for the ops materials order sheet 404 / empty-sheet bug (Sept 2026).
 *
 * The print route used to read `production_jobs.total_squares` + `proposals.measurement_id`
 * (neither column exists) and only followed `linked_proposal_id`. Real jobs carry
 * `accepted_proposal_id` with `linked_proposal_id` null, and essentially every roof_measurements
 * row is linked by `opportunity_id` only — so both legs have to work or the sheet prints blank.
 */

const ORG = 'org-1'
type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: null }> {
  private eqs: [string, unknown][] = []
  private ins: [string, unknown[]][] = []
  private notNull: string[] = []
  private gts: [string, number][] = []
  private orderBy: { col: string; asc: boolean } | null = null
  private max: number | null = null

  constructor(private db: Record<string, Row[]>, private table: string) {}

  select() {
    return this
  }
  eq(col: string, value: unknown) {
    this.eqs.push([col, value])
    return this
  }
  in(col: string, values: unknown[]) {
    this.ins.push([col, values])
    return this
  }
  not(col: string, _op: string, _value: unknown) {
    this.notNull.push(col)
    return this
  }
  gt(col: string, value: number) {
    this.gts.push([col, value])
    return this
  }
  or() {
    // PostgREST `or()` strings are not parsed here; every test case is pinned by eq/in/not instead.
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }

  private rows(): Row[] {
    let rows = (this.db[this.table] || []).slice()
    for (const [col, value] of this.eqs) rows = rows.filter((r) => r[col] === value)
    for (const [col, values] of this.ins) rows = rows.filter((r) => values.includes(r[col]))
    for (const col of this.notNull) rows = rows.filter((r) => r[col] != null)
    for (const [col, value] of this.gts) rows = rows.filter((r) => Number(r[col]) > value)
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      rows.sort((a, b) => {
        const l = String(a[col] ?? '')
        const r = String(b[col] ?? '')
        return asc ? l.localeCompare(r) : r.localeCompare(l)
      })
    }
    return this.max != null ? rows.slice(0, this.max) : rows
  }

  async maybeSingle() {
    return { data: this.rows()[0] ?? null, error: null }
  }

  then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.rows(), error: null as null }).then(onfulfilled, onrejected)
  }
}

function fakeClient(db: Record<string, Row[]>) {
  return { from: (table: string) => new FakeQuery(db, table) } as never
}

// Job 26-0044 as it actually exists in production: no linked_proposal_id, an accepted_proposal_id
// pointing at a proposal that was never stamped accepted_at, and a measurement on the opportunity.
const PROPOSAL = {
  id: 'prop-44',
  org_id: ORG,
  proposal_number: 'P-00165',
  sold_squares: 29.56,
  measured_squares: 24.63,
  sold_waste_percent: 20,
  opportunity_id: 'opp-44',
  project_id: null,
  accepted_at: null,
}

const MEASUREMENT = {
  id: 'measure-44',
  org_id: ORG,
  proposal_id: null,
  opportunity_id: 'opp-44',
  project_id: null,
  total_squares: 24.63,
  ridges_lf: 83,
  hips_lf: 20,
  valleys_lf: 13,
  eaves_lf: 223.7,
  rakes_lf: 209.4,
  step_flashing_lf: 62,
  drip_edge_lf: 433.1,
  flashing_lf: 0,
  penetration_count: 4,
  source: 'in_house',
  raw_data: null,
  suggested_waste_percent: null,
  updated_at: '2026-09-05T02:59:51Z',
}

const JOB = {
  id: 'job-44',
  org_id: ORG,
  job_number: '26-0044',
  job_type: 'roofing',
  project_id: 'proj-44',
  linked_proposal_id: null,
  accepted_proposal_id: 'prop-44',
  project: { opportunity_id: 'opp-44', sold_roof_squares: null },
}

describe('buildJobSoldScope', () => {
  it('resolves squares and linear footages for a job linked only by accepted_proposal_id', async () => {
    const admin = fakeClient({
      proposals: [PROPOSAL],
      proposal_line_items: [],
      roof_measurements: [MEASUREMENT],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: 'opp-44' }],
    })

    const scope = await buildJobSoldScope({ admin, orgId: ORG, job: JOB })

    expect(scope).not.toBeNull()
    expect(scope!.proposal_id).toBe('prop-44')
    expect(scope!.proposal_number).toBe('P-00165')
    // Sold squares already include the 20% waste — this is what the supplier order is sized from.
    expect(scope!.total_squares).toBe(29.56)
    expect(scope!.measured_squares).toBe(24.63)
    expect(scope!.waste_percent).toBe(20)
    expect(scope!.roof_measurement_linear).toMatchObject({
      ridges_lf: 83,
      hips_lf: 20,
      valleys_lf: 13,
      eaves_lf: 223.7,
      rakes_lf: 209.4,
      step_flashing_lf: 62,
      drip_edge_lf: 433.1,
    })
    expect(scope!.materials_extras?.penetration_count).toBe(4)
  })

  it('finds the measurement through the project when the proposal has no opportunity', async () => {
    const admin = fakeClient({
      proposals: [{ ...PROPOSAL, opportunity_id: null }],
      proposal_line_items: [],
      roof_measurements: [MEASUREMENT],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: 'opp-44' }],
    })

    const scope = await buildJobSoldScope({ admin, orgId: ORG, job: JOB })
    expect(scope!.roof_measurement_linear?.ridges_lf).toBe(83)
  })

  it('honours an explicit opportunityId override, including a null one', async () => {
    const admin = fakeClient({
      proposals: [PROPOSAL],
      proposal_line_items: [],
      roof_measurements: [MEASUREMENT],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: 'opp-44' }],
    })

    // The job page resolves the opportunity itself; passing null must not be second-guessed.
    const scope = await buildJobSoldScope({
      admin,
      orgId: ORG,
      job: { ...JOB, project_id: null },
      opportunityId: null,
    })
    expect(scope!.total_squares).toBe(29.56)
    expect(scope!.roof_measurement_linear).toBeNull()
  })

  it('reads linear footages that only ever landed in raw_data', async () => {
    // Older/imported measurement rows carry the LF in raw_data with the columns null.
    // `lib/job-run-sheet.ts` has always fallen back to raw_data, so the order sheet must too —
    // when only the run sheet did, it quoted the crew a starter bundle count the supplier order
    // sheet omitted entirely and starter never got ordered.
    const admin = fakeClient({
      proposals: [PROPOSAL],
      proposal_line_items: [],
      roof_measurements: [
        {
          ...MEASUREMENT,
          eaves_lf: null,
          rakes_lf: null,
          ridges_lf: null,
          drip_edge_lf: null,
          raw_data: { eaves_lf: 223.7, rakes_lf: 209.4, ridges_lf: 83, drip_edge_lf: 433.1 },
        },
      ],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: 'opp-44' }],
    })

    const scope = await buildJobSoldScope({ admin, orgId: ORG, job: JOB })
    expect(scope!.roof_measurement_linear).toMatchObject({
      eaves_lf: 223.7,
      rakes_lf: 209.4,
      ridges_lf: 83,
      drip_edge_lf: 433.1,
    })
  })

  it('falls back to an address match when neither proposal nor project has an opportunity', async () => {
    // The supplier order sheet has no access to the job page's contract/address resolution, so
    // without this leg it resolved a different opportunity than the card ops read on screen —
    // and printed a blank sheet for a job whose measurement is linked by opportunity_id only.
    const admin = fakeClient({
      proposals: [{ ...PROPOSAL, opportunity_id: null }],
      proposal_line_items: [],
      roof_measurements: [MEASUREMENT],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: null }],
      opportunities: [{ id: 'opp-44', org_id: ORG, address_text: '512 Ridgeview Dr' }],
    })

    const scope = await buildJobSoldScope({
      admin,
      orgId: ORG,
      job: { ...JOB, address_text: '512 Ridgeview Dr' },
    })
    expect(scope!.roof_measurement_linear?.ridges_lf).toBe(83)
  })

  it('does not match an address belonging to another org', async () => {
    const admin = fakeClient({
      proposals: [{ ...PROPOSAL, opportunity_id: null }],
      proposal_line_items: [],
      roof_measurements: [MEASUREMENT],
      projects: [{ id: 'proj-44', org_id: ORG, opportunity_id: null }],
      opportunities: [{ id: 'opp-44', org_id: 'org-2', address_text: '512 Ridgeview Dr' }],
    })

    const scope = await buildJobSoldScope({
      admin,
      orgId: ORG,
      job: { ...JOB, address_text: '512 Ridgeview Dr' },
    })
    expect(scope!.roof_measurement_linear).toBeNull()
  })

  it('returns null when there is nothing sold and nothing measured', async () => {
    const admin = fakeClient({
      proposals: [],
      proposal_line_items: [],
      roof_measurements: [],
      projects: [],
    })

    const scope = await buildJobSoldScope({
      admin,
      orgId: ORG,
      job: { ...JOB, accepted_proposal_id: null, project: { opportunity_id: null, sold_roof_squares: null } },
    })
    expect(scope).toBeNull()
  })
})
