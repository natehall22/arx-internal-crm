/**
 * Guards the live sit-pay path while the inside-sales booker credit is layered on.
 *
 * The rule that matters most here: adding the booker credit must not change a
 * single existing sit line. Payroll is live, sit pay is recomputed from the
 * database on every statement render, and the setter keeps setter attribution.
 */
import { fetchPeriodUnitPayLinesForUser } from '@/lib/comp-plan-period-unit-earnings'
import {
  fetchEffectiveSitOpportunitiesInPeriod,
  fetchFirstQualifyingSitOpportunitiesByIds,
} from '@/lib/dashboard-sit-metrics'

jest.mock('@/lib/dashboard-sit-metrics', () => ({
  fetchEffectiveSitOpportunitiesInPeriod: jest.fn(),
  fetchFirstQualifyingSitOpportunitiesByIds: jest.fn(),
}))

const mockFetchSits = fetchEffectiveSitOpportunitiesInPeriod as jest.MockedFunction<
  typeof fetchEffectiveSitOpportunitiesInPeriod
>
const mockFetchHistoricalSits = fetchFirstQualifyingSitOpportunitiesByIds as jest.MockedFunction<
  typeof fetchFirstQualifyingSitOpportunitiesByIds
>

const ORG = 'org-1'
const RODA = 'user-roda'
const EVAN = 'user-evan'
const START = '2026-08-01T00:00:00.000Z'
const END = '2026-09-01T00:00:00.000Z'

const ORG_SETTINGS = {
  inspection_outcomes: [
    { id: 'insurance_follow_up', label: 'Insurance Follow Up', active: true, counts_as_sit: true },
    { id: 'moving_to_close', label: 'Moving to Close', active: true, counts_as_sit: true },
  ],
}

type Rows = Record<string, unknown>[]

/**
 * Minimal PostgREST-shaped stub. Routes by table name, and for `orgs` by which
 * columns were selected (the settings read and the feature-gate read are separate
 * queries on purpose, so the gate's absence cannot break sit pay).
 */
function makeSupabase(opts: {
  orgSettings?: Rows[number] | null
  gate?: { data: Rows[number] | null; error: { message: string } | null }
  appointments?: { data: Rows | null; error: { message: string } | null }
  opportunities?: Rows
}) {
  const calls: string[] = []

  function builder(table: string) {
    let selected = ''
    const node: Record<string, unknown> = {}
    const passthrough = () => node

    node.select = (cols: string) => {
      selected = cols
      return node
    }
    node.eq = passthrough
    node.in = passthrough
    node.not = passthrough
    node.gte = passthrough
    node.lt = passthrough

    node.maybeSingle = () => {
      if (table === 'orgs' && selected.includes('settings')) {
        calls.push('orgs:settings')
        return Promise.resolve({ data: { settings: opts.orgSettings ?? ORG_SETTINGS }, error: null })
      }
      if (table === 'orgs') {
        calls.push('orgs:gate')
        return Promise.resolve(opts.gate ?? { data: null, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }

    let orderCalls = 0
    node.order = () => {
      orderCalls += 1
      if (table === 'scheduled_appointments' && orderCalls >= 2) {
        calls.push('scheduled_appointments')
        return Promise.resolve(opts.appointments ?? { data: [], error: null })
      }
      return node
    }

    node.range = (from: number) => {
      if (table === 'opportunities') {
        calls.push('opportunities')
        return Promise.resolve({ data: from === 0 ? opts.opportunities ?? [] : [], error: null })
      }
      return Promise.resolve({ data: [], error: null })
    }

    return node
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    calls,
  }
}

const SETTER_SIT = {
  id: 'opp-evan',
  lead_id: 'lead-evan',
  setter_user_id: EVAN,
  owner_user_id: EVAN,
  inspection_outcome: 'insurance_follow_up',
  inspection_outcome_at: '2026-08-04T10:41:36.000Z',
}

const RODA_SETTER_SIT = {
  id: 'opp-roda-set',
  lead_id: 'lead-roda',
  setter_user_id: RODA,
  owner_user_id: RODA,
  inspection_outcome: 'moving_to_close',
  inspection_outcome_at: '2026-08-10T15:00:00.000Z',
}

const BOOKED_APPOINTMENT = {
  id: 'appt-1',
  opportunity_id: 'opp-evan',
  lead_id: 'lead-evan',
  appointment_type: 'insurance_call',
  status: 'completed',
  scheduled_for: '2026-08-08T12:00:00.000Z',
  inside_sales_booked_by_user_id: RODA,
  inside_sales_sit_credit_excluded: false,
}

const GATE_ON = {
  data: { inside_sales_sit_credit_enabled: true, inside_sales_sit_credit_effective_from: '2026-08-01' },
  error: null,
}

async function run(supabase: never, userId: string) {
  return fetchPeriodUnitPayLinesForUser(supabase, {
    orgId: ORG,
    userId,
    startIso: START,
    endIso: END,
    unitTypes: ['sit'],
    sitRate: 10,
    saleRate: 5,
  })
}

beforeEach(() => {
  mockFetchSits.mockReset()
  mockFetchHistoricalSits.mockReset()
  mockFetchHistoricalSits.mockResolvedValue([])
})

describe('inside-sales booker credit inside period unit pay', () => {
  it('leaves the setter sit exactly as-is and pays the setter nothing extra', async () => {
    mockFetchSits.mockResolvedValue([SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: { data: [BOOKED_APPOINTMENT], error: null },
      opportunities: [
        { id: 'opp-evan', lead_id: 'lead-evan', address_text: '540 Acorn Oaks Dr', leads: { homeowner_name: 'Author Jones' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, EVAN)

    // Evan is the setter: one sit line, unchanged, at the original outcome date.
    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay')
    expect(sitLines[0].opportunityId).toBe('opp-evan')
    expect(sitLines[0].eventDate).toBe('2026-08-04')
    expect(sitLines[0].amount).toBe(10)
  })

  it('pays the inside-sales booker a separate sit unit on the same opportunity', async () => {
    mockFetchSits.mockResolvedValue([SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: { data: [BOOKED_APPOINTMENT], error: null },
      opportunities: [
        { id: 'opp-evan', lead_id: 'lead-evan', address_text: '540 Acorn Oaks Dr', leads: { homeowner_name: 'Author Jones' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay (inside sales booking)')
    expect(sitLines[0].customerName).toBe('Author Jones')
    expect(sitLines[0].opportunityId).toBe('opp-evan')
    // Dated from the appointment, not the setter's inspection outcome.
    expect(sitLines[0].eventDate).toBe('2026-08-08')
    expect(sitLines[0].amount).toBe(10)
  })

  it('pays nothing extra while the org gate is off — the default on deploy', async () => {
    mockFetchSits.mockResolvedValue([SETTER_SIT] as never)
    const { client, calls } = makeSupabase({
      gate: { data: { inside_sales_sit_credit_enabled: false, inside_sales_sit_credit_effective_from: null }, error: null },
      appointments: { data: [BOOKED_APPOINTMENT], error: null },
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toEqual([])
    expect(calls).not.toContain('scheduled_appointments')
  })

  it('treats a missing gate column as off instead of breaking payroll', async () => {
    // Before migration 202608050005 is applied, PostgREST errors on these columns.
    mockFetchSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: { data: null, error: { message: 'column orgs.inside_sales_sit_credit_enabled does not exist' } },
      opportunities: [
        { id: 'opp-roda-set', lead_id: 'lead-roda', address_text: '1 Main St', leads: { homeowner_name: 'Jane Doe' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, RODA)

    // Her existing setter sit still pays in full.
    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay')
    expect(sitLines[0].amount).toBe(10)
  })

  it('fails closed on a transient gate query error instead of silently dropping earned credit', async () => {
    mockFetchSits.mockResolvedValue([] as never)
    const { client } = makeSupabase({
      gate: { data: null, error: { message: 'database temporarily unavailable' } },
    })

    await expect(run(client, RODA)).rejects.toEqual({
      message: 'database temporarily unavailable',
    })
  })

  it('never pays one rep two sit units on the same opportunity', async () => {
    // Roda is the setter on 18 real opportunities, so a booker credit landing on an
    // opportunity she already earned the setter sit for is a real collision.
    mockFetchSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    mockFetchHistoricalSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: {
        data: [{ ...BOOKED_APPOINTMENT, opportunity_id: 'opp-roda-set', lead_id: 'lead-roda' }],
        error: null,
      },
      opportunities: [
        { id: 'opp-roda-set', lead_id: 'lead-roda', address_text: '1 Main St', leads: { homeowner_name: 'Jane Doe' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay')
  })

  it('does not pay a later booker credit when the same rep earned the setter sit in an earlier period', async () => {
    mockFetchSits.mockResolvedValue([] as never)
    mockFetchHistoricalSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: {
        data: [{ ...BOOKED_APPOINTMENT, opportunity_id: 'opp-roda-set', lead_id: 'lead-roda' }],
        error: null,
      },
      opportunities: [],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toEqual([])
  })

  it('pays the booker one sit unit once the attendee completes the adjuster meeting', async () => {
    mockFetchSits.mockResolvedValue([SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: {
        data: [
          {
            ...BOOKED_APPOINTMENT,
            appointment_type: 'adjuster_meeting',
            status: 'completed',
            closer_user_id: 'user-nathan',
            duration_minutes: 60,
          },
        ],
        error: null,
      },
      opportunities: [
        { id: 'opp-evan', lead_id: 'lead-evan', address_text: '540 Acorn Oaks Dr', leads: { homeowner_name: 'Author Jones' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay (inside sales booking)')
    expect(sitLines[0].amount).toBe(10)
    expect(sitLines[0].eventDate).toBe('2026-08-08')
  })

  it('pays the attending rep nothing extra for attending', async () => {
    // The attendee earns no unit here — owner was explicit. They are not the setter
    // on this deal and hold no per-unit sit credit for showing up.
    mockFetchSits.mockResolvedValue([SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: { data: [], error: null },
      opportunities: [],
    })

    const { sitLines } = await run(client, 'user-nathan')

    expect(sitLines).toEqual([])
  })

  it.each(['no_show', 'cancelled', 'scheduled'])('pays nothing when the meeting is %s', async (status) => {
    mockFetchSits.mockResolvedValue([] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: {
        data: [{ ...BOOKED_APPOINTMENT, appointment_type: 'adjuster_meeting', status }],
        error: null,
      },
      opportunities: [],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toEqual([])
  })

  it('suppresses the credit when the booker is also the setter on that opportunity', async () => {
    mockFetchSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    mockFetchHistoricalSits.mockResolvedValue([RODA_SETTER_SIT] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: {
        data: [
          {
            ...BOOKED_APPOINTMENT,
            appointment_type: 'adjuster_meeting',
            status: 'completed',
            opportunity_id: 'opp-roda-set',
            lead_id: 'lead-roda',
          },
        ],
        error: null,
      },
      opportunities: [
        { id: 'opp-roda-set', lead_id: 'lead-roda', address_text: '1 Main St', leads: { homeowner_name: 'Jane Doe' }, customers: null },
      ],
    })

    const { sitLines } = await run(client, RODA)

    expect(sitLines).toHaveLength(1)
    expect(sitLines[0].payTypeLabel).toBe('Sit pay')
  })

  it('fails closed when the appointment query errors rather than silently dropping pay', async () => {
    mockFetchSits.mockResolvedValue([] as never)
    const { client } = makeSupabase({
      gate: GATE_ON,
      appointments: { data: null, error: { message: 'boom' } },
    })

    await expect(run(client, RODA)).rejects.toBeTruthy()
  })
})
