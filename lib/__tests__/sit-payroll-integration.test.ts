/**
 * Integration-style coverage for the payroll `eligibilityMode: 'first_qualifying'`
 * sit rewrite, exercising the real query-discovery/pagination/aggregation path
 * (via a filtering in-memory Supabase mock) rather than only the pure
 * `pickFirstQualifyingInspection` picker already covered in dashboard-sit-metrics.test.ts.
 *
 * Covers the CLAUDE_MORNING_BUILD_MONTHLY_TIER_METRIC_MAPS_AUDIT.md P0/P1/P2 findings:
 * orphaned-lead discovery (P0#1), >1000-row pagination (P0#2), Eastern month
 * boundaries (P1#3/#5), missing-timestamp skip+reporting (P1#4), fail-closed on
 * query error (P2#6), and the equal-timestamp id tie-break (P2#7).
 */

import { fetchEffectiveSitOpportunitiesInPeriod } from '@/lib/dashboard-sit-metrics'
import { buildMonthlyTierMetricMaps, periodSitsAndCloseRateForParticipant, collectParticipants } from '@/lib/payroll-export'
import { fetchPeriodUnitPayLinesForUser } from '@/lib/comp-plan-period-unit-earnings'

type Row = Record<string, unknown>

/**
 * Minimal in-memory Supabase stand-in: `.from(table)` returns a chainable builder
 * that records `.eq/.in/.gte/.lt/.lte/.not` predicates and applies them against a
 * full in-memory table snapshot on resolution (`.then()`/`.maybeSingle()`), then
 * `.order()`/`.range()` for pagination — so callers don't need to hand-sequence
 * per-call responses, and `.range()` pagination is exercised for real.
 */
function createInMemorySupabase(tables: Record<string, Row[]>, errorTables: Set<string> = new Set()) {
  const from = (table: string) => {
    if (errorTables.has(table)) {
      const failing = {
        select: () => failing,
        eq: () => failing,
        in: () => failing,
        gte: () => failing,
        lt: () => failing,
        lte: () => failing,
        not: () => failing,
        order: () => failing,
        range: () => failing,
        maybeSingle: () => Promise.resolve({ data: null, error: { message: `mock error: ${table}` } }),
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: null, error: { message: `mock error: ${table}` } }),
      }
      return failing
    }

    const rows = tables[table] || []
    let filtered = rows.slice()
    let orderKey: string | null = null
    let orderAsc = true
    let rangeFrom: number | null = null
    let rangeTo: number | null = null

    const builder: Record<string, (...args: never[]) => unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val)
      return builder
    }
    builder.in = (col: string, vals: unknown[]) => {
      const set = new Set(vals)
      filtered = filtered.filter((r) => set.has(r[col]))
      return builder
    }
    builder.gte = (col: string, val: string) => {
      filtered = filtered.filter((r) => typeof r[col] === 'string' && (r[col] as string) >= val)
      return builder
    }
    builder.lt = (col: string, val: string) => {
      filtered = filtered.filter((r) => typeof r[col] === 'string' && (r[col] as string) < val)
      return builder
    }
    builder.lte = (col: string, val: string) => {
      filtered = filtered.filter((r) => typeof r[col] === 'string' && (r[col] as string) <= val)
      return builder
    }
    builder.not = (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) {
        filtered = filtered.filter((r) => r[col] !== null && r[col] !== undefined)
      }
      return builder
    }
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      orderKey = col
      orderAsc = opts?.ascending !== false
      return builder
    }
    builder.range = (rFrom: number, rTo: number) => {
      rangeFrom = rFrom
      rangeTo = rTo
      return builder
    }

    const resolve = () => {
      let result = filtered
      if (orderKey) {
        const key = orderKey
        result = [...result].sort((a, b) => {
          const av = String(a[key] ?? '')
          const bv = String(b[key] ?? '')
          if (av === bv) return 0
          return av < bv ? -1 : 1
        })
        if (!orderAsc) result = result.reverse()
      }
      if (rangeFrom !== null && rangeTo !== null) {
        result = result.slice(rangeFrom, rangeTo + 1)
      }
      return { data: result, error: null }
    }

    builder.maybeSingle = () => {
      const { data } = resolve()
      return Promise.resolve({ data: (data as Row[])[0] ?? null, error: null })
    }
    builder.then = (resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(resolveFn, rejectFn)

    return builder
  }

  return { from } as never
}

const ORG_ID = 'org-1'
const SIT_SET = new Set(['moving_to_close'])

function statusRow(overrides: Row): Row {
  return {
    id: `sr-${Math.random().toString(36).slice(2)}`,
    org_id: ORG_ID,
    opportunity_id: null,
    lead_id: null,
    outcome: null,
    notes: null,
    created_at: '2026-07-01T12:00:00.000Z',
    ...overrides,
  }
}

function oppRow(overrides: Row): Row {
  return {
    id: `opp-${Math.random().toString(36).slice(2)}`,
    org_id: ORG_ID,
    lead_id: null,
    setter_user_id: null,
    owner_user_id: null,
    inspection_outcome: null,
    inspection_outcome_at: null,
    inspection_notes: null,
    updated_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

const PERIOD = { startIso: '2026-07-01T00:00:00.000Z', endIso: '2026-08-01T00:00:00.000Z' }

describe('fetchEffectiveSitOpportunitiesInPeriod (first_qualifying, real query path)', () => {
  it('P0#1: orphaned row on a lead with two opportunities credits neither (no wrong-person / double pay)', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: null,
          lead_id: 'lead-shared',
          outcome: 'moving_to_close',
          created_at: '2026-07-10T12:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-old', lead_id: 'lead-shared', setter_user_id: 'setter-old', owner_user_id: 'owner-old' }),
        oppRow({ id: 'opp-new', lead_id: 'lead-shared', setter_user_id: 'setter-new', owner_user_id: 'owner-new' }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })

    expect(results).toEqual([])
  })

  it('control: orphaned row on a lead with exactly one opportunity still credits it', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: null,
          lead_id: 'lead-solo',
          outcome: 'moving_to_close',
          created_at: '2026-07-10T12:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-solo', lead_id: 'lead-solo', setter_user_id: 'setter-a', owner_user_id: 'owner-a' }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('opp-solo')
    expect(results[0].setter_user_id).toBe('setter-a')
  })

  it('collateral regression: default (latest) mode does not double-count an orphaned row across a re-knocked lead\'s two opportunities', async () => {
    // mergeEffectiveInspectionFields (the 'latest'-mode merge path) has no
    // ambiguousLeadIds guard — it matches a lead_id status row to whichever
    // opportunity asks. Widening discovery to pull in every opportunity for an
    // ambiguity-reliant lead (the P0#1 fix, needed for first_qualifying mode) must
    // NOT also apply to 'latest' mode, or the same orphaned row would get credited
    // to both opp-old and opp-new here. Dashboard/goals/team-stats/personal-stats/
    // morning-update all use this default mode and must keep the pre-existing
    // one-opportunity-per-lead (newest) behavior.
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: null,
          lead_id: 'lead-shared-latest',
          outcome: 'moving_to_close',
          created_at: '2026-07-10T12:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({
          id: 'opp-older',
          lead_id: 'lead-shared-latest',
          setter_user_id: 'setter-older',
          owner_user_id: 'owner-older',
          created_at: '2026-06-01T00:00:00.000Z',
        }),
        oppRow({
          id: 'opp-newer',
          lead_id: 'lead-shared-latest',
          setter_user_id: 'setter-newer',
          owner_user_id: 'owner-newer',
          created_at: '2026-07-01T00:00:00.000Z',
        }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      // No eligibilityMode passed — exercises the default 'latest' path, matching
      // every real non-payroll call site (none of them pass eligibilityMode).
    })

    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('opp-newer')
  })

  it('P0#2: finds the earliest qualifying sit even when it is on the second page (>1000 rows)', async () => {
    const statusRows: Row[] = []
    for (let i = 0; i < 1000; i++) {
      statusRows.push(
        statusRow({
          id: `aa-${String(i).padStart(4, '0')}`,
          opportunity_id: 'opp-paged',
          lead_id: 'lead-paged',
          outcome: 'not_home',
          created_at: `2026-07-15T${String(10 + (i % 10)).padStart(2, '0')}:00:00.000Z`,
        })
      )
    }
    // Sorts last by id (page 2 of a 1000-row page size) but has the earliest
    // timestamp of all 1001 rows and a qualifying outcome.
    statusRows.push(
      statusRow({
        id: 'zz-earliest',
        opportunity_id: 'opp-paged',
        lead_id: 'lead-paged',
        outcome: 'moving_to_close',
        created_at: '2026-07-02T00:00:00.000Z',
      })
    )

    const supabase = createInMemorySupabase({
      inspection_status_updates: statusRows,
      opportunities: [
        oppRow({ id: 'opp-paged', lead_id: 'lead-paged', setter_user_id: 'setter-a', owner_user_id: 'owner-a' }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })

    expect(results).toHaveLength(1)
    expect(results[0].inspection_outcome_at).toBe('2026-07-02T00:00:00.000Z')
  })

  it('first sit and a later re-sit in the same month: only the first counts, no duplicate', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: 'opp-resit',
          lead_id: 'lead-resit',
          outcome: 'moving_to_close',
          created_at: '2026-07-05T09:00:00.000Z',
        }),
        statusRow({
          opportunity_id: 'opp-resit',
          lead_id: 'lead-resit',
          outcome: 'moving_to_close',
          created_at: '2026-07-20T09:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-resit', lead_id: 'lead-resit', setter_user_id: 'setter-a', owner_user_id: 'owner-a' }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })

    expect(results).toHaveLength(1)
    expect(results[0].inspection_outcome_at).toBe('2026-07-05T09:00:00.000Z')
  })

  it('first sit and re-sit in different months: only the first (earlier) month counts', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: 'opp-cross-month',
          lead_id: 'lead-cross-month',
          outcome: 'moving_to_close',
          created_at: '2026-07-31T23:00:00.000Z',
        }),
        statusRow({
          opportunity_id: 'opp-cross-month',
          lead_id: 'lead-cross-month',
          outcome: 'moving_to_close',
          created_at: '2026-08-15T09:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({
          id: 'opp-cross-month',
          lead_id: 'lead-cross-month',
          setter_user_id: 'setter-a',
          owner_user_id: 'owner-a',
        }),
      ],
    })

    const julyResults = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      startIso: '2026-07-01T00:00:00.000Z',
      endIso: '2026-08-01T00:00:00.000Z',
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })
    expect(julyResults).toHaveLength(1)

    const augResults = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      startIso: '2026-08-01T00:00:00.000Z',
      endIso: '2026-09-01T00:00:00.000Z',
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })
    expect(augResults).toHaveLength(0)
  })

  it('P1#4: qualifying outcome with no inspection_outcome_at and no status rows is excluded and reported', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [],
      opportunities: [
        oppRow({
          id: 'opp-untimed',
          lead_id: 'lead-untimed',
          setter_user_id: 'setter-a',
          owner_user_id: 'owner-a',
          inspection_outcome: 'moving_to_close',
          inspection_outcome_at: null,
          updated_at: '2026-07-10T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      ],
    })

    const skipped: string[] = []
    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
      onSkippedForMissingTimestamp: (id) => skipped.push(id),
    })

    expect(results).toEqual([])
    // Opportunity has no inspection_outcome_at and no status rows in-period, so it's
    // never discovered via oppsByOutcomeAt/leadIdSet in the first place — nothing to
    // skip-and-report either. Confirms it's silently (safely) absent, not mis-dated.
    expect(skipped).toEqual([])
  })

  it('P1#4: qualifying outcome discovered via a status row but missing inspection_outcome_at reports itself skipped only when it would otherwise be used', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        statusRow({
          opportunity_id: 'opp-partial',
          lead_id: 'lead-partial',
          outcome: 'not_home',
          created_at: '2026-07-05T00:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({
          id: 'opp-partial',
          lead_id: 'lead-partial',
          setter_user_id: 'setter-a',
          owner_user_id: 'owner-a',
          inspection_outcome: 'moving_to_close',
          inspection_outcome_at: null,
          updated_at: '2026-07-10T00:00:00.000Z',
        }),
      ],
    })

    const skipped: string[] = []
    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
      onSkippedForMissingTimestamp: (id) => skipped.push(id),
    })

    expect(results).toEqual([])
    expect(skipped).toEqual(['opp-partial'])
  })

  it('duplicate status rows returned by both the by-opportunity and by-lead reconstruction queries count once', async () => {
    const supabase = createInMemorySupabase({
      inspection_status_updates: [
        // Has both opportunity_id and lead_id, so it matches the by-opportunity
        // query (.in('opportunity_id', ...)) AND the by-lead query
        // (.in('lead_id', ...)) — the underlying table has one row, not two.
        statusRow({
          opportunity_id: 'opp-dup',
          lead_id: 'lead-dup',
          outcome: 'moving_to_close',
          created_at: '2026-07-05T00:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-dup', lead_id: 'lead-dup', setter_user_id: 'setter-a', owner_user_id: 'owner-a' }),
      ],
    })

    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: SIT_SET,
      eligibilityMode: 'first_qualifying',
    })

    expect(results).toHaveLength(1)
  })

  it('empty sitOutcomeIdSet short-circuits to [] without querying', async () => {
    const supabase = createInMemorySupabase({})
    const results = await fetchEffectiveSitOpportunitiesInPeriod(supabase, {
      orgId: ORG_ID,
      ...PERIOD,
      sitOutcomeIdSet: new Set(),
      eligibilityMode: 'first_qualifying',
    })
    expect(results).toEqual([])
  })
})

describe('buildMonthlyTierMetricMaps (payroll-export.ts consumer)', () => {
  it('P0#1: orphaned-lead ambiguity produces no tier credit for either opportunity', async () => {
    const supabase = createInMemorySupabase({
      orgs: [{ id: ORG_ID, settings: {} }],
      inspection_status_updates: [
        statusRow({
          opportunity_id: null,
          lead_id: 'lead-shared',
          outcome: 'moving_to_close',
          created_at: '2026-07-10T12:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-old', lead_id: 'lead-shared', setter_user_id: 'setter-old', owner_user_id: 'owner-old' }),
        oppRow({ id: 'opp-new', lead_id: 'lead-shared', setter_user_id: 'setter-new', owner_user_id: 'owner-new' }),
      ],
      order_form_contracts: [],
    })

    const { sitsBySetterMonth, sitsByOwnerMonth } = await buildMonthlyTierMetricMaps(
      supabase,
      ORG_ID,
      '2026-07-01',
      '2026-07-31'
    )

    expect(sitsBySetterMonth.size).toBe(0)
    expect(sitsByOwnerMonth.size).toBe(0)
  })

  it('P1#3/#5: an 11:30pm Eastern July 31 sit lands in July, not August, in the tier map', async () => {
    // 2026-07-31 23:30 Eastern (EDT, UTC-4) = 2026-08-01 03:30 UTC.
    const lateJulyEasternUtc = '2026-08-01T03:30:00.000Z'
    const supabase = createInMemorySupabase({
      orgs: [{ id: ORG_ID, settings: {} }],
      inspection_status_updates: [
        statusRow({
          opportunity_id: 'opp-late',
          lead_id: 'lead-late',
          outcome: 'moving_to_close',
          created_at: lateJulyEasternUtc,
        }),
      ],
      opportunities: [
        oppRow({
          id: 'opp-late',
          lead_id: 'lead-late',
          setter_user_id: 'setter-late',
          owner_user_id: 'owner-late',
        }),
      ],
      order_form_contracts: [],
    })

    const { sitsBySetterMonth } = await buildMonthlyTierMetricMaps(supabase, ORG_ID, '2026-07-01', '2026-07-31')

    expect(sitsBySetterMonth.get('setter-late|2026-07')).toBe(1)
  })

  it('P2#6: a sit-query failure propagates instead of resolving with empty maps', async () => {
    const supabase = createInMemorySupabase(
      { orgs: [{ id: ORG_ID, settings: {} }], opportunities: [], order_form_contracts: [] },
      new Set(['inspection_status_updates'])
    )

    await expect(buildMonthlyTierMetricMaps(supabase, ORG_ID, '2026-07-01', '2026-07-31')).rejects.toBeTruthy()
  })

  it('P2#6: a contracts-query failure propagates instead of resolving with empty maps', async () => {
    const supabase = createInMemorySupabase(
      {
        orgs: [{ id: ORG_ID, settings: {} }],
        inspection_status_updates: [],
        opportunities: [],
      },
      new Set(['order_form_contracts'])
    )

    await expect(buildMonthlyTierMetricMaps(supabase, ORG_ID, '2026-07-01', '2026-07-31')).rejects.toBeTruthy()
  })
})

describe('fetchPeriodUnitPayLinesForUser (comp-plan-period-unit-earnings.ts consumer)', () => {
  it('P0#1: orphaned-lead ambiguity produces no sit-pay line for either setter', async () => {
    const supabase = createInMemorySupabase({
      orgs: [{ id: ORG_ID, settings: {} }],
      inspection_status_updates: [
        statusRow({
          opportunity_id: null,
          lead_id: 'lead-shared',
          outcome: 'moving_to_close',
          created_at: '2026-07-10T12:00:00.000Z',
        }),
      ],
      opportunities: [
        oppRow({ id: 'opp-old', lead_id: 'lead-shared', setter_user_id: 'setter-old', owner_user_id: 'owner-old' }),
        oppRow({ id: 'opp-new', lead_id: 'lead-shared', setter_user_id: 'setter-new', owner_user_id: 'owner-new' }),
      ],
    })

    const oldResult = await fetchPeriodUnitPayLinesForUser(supabase, {
      orgId: ORG_ID,
      userId: 'setter-old',
      ...PERIOD,
      unitTypes: ['sit'],
      sitRate: 50,
      saleRate: 100,
    })
    const newResult = await fetchPeriodUnitPayLinesForUser(supabase, {
      orgId: ORG_ID,
      userId: 'setter-new',
      ...PERIOD,
      unitTypes: ['sit'],
      sitRate: 50,
      saleRate: 100,
    })

    expect(oldResult.sitLines).toEqual([])
    expect(newResult.sitLines).toEqual([])
  })
})

describe('periodSitsAndCloseRateForParticipant (close-rate edge cases)', () => {
  it('owner with sits but zero sales: 0% close rate, not null', () => {
    const { periodClosingRatePct } = periodSitsAndCloseRateForParticipant({
      userId: 'owner-a',
      monthKey: '2026-07',
      participantRole: 'owner',
      sitsBySetterMonth: new Map(),
      sitsByOwnerMonth: new Map([['owner-a|2026-07', 4]]),
      salesByOwnerMonth: new Map(),
    })
    expect(periodClosingRatePct).toBe(0)
  })

  it('owner with zero sits: null close rate (not a division-by-zero 0%)', () => {
    const { periodClosingRatePct, periodSits } = periodSitsAndCloseRateForParticipant({
      userId: 'owner-a',
      monthKey: '2026-07',
      participantRole: 'owner',
      sitsBySetterMonth: new Map(),
      sitsByOwnerMonth: new Map(),
      salesByOwnerMonth: new Map([['owner-a|2026-07', 2]]),
    })
    expect(periodSits).toBe(0)
    expect(periodClosingRatePct).toBeNull()
  })

  it('owner with sales greater than sits: closing rate over 100%', () => {
    const { periodClosingRatePct } = periodSitsAndCloseRateForParticipant({
      userId: 'owner-a',
      monthKey: '2026-07',
      participantRole: 'owner',
      sitsBySetterMonth: new Map(),
      sitsByOwnerMonth: new Map([['owner-a|2026-07', 2]]),
      salesByOwnerMonth: new Map([['owner-a|2026-07', 3]]),
    })
    expect(periodClosingRatePct).toBe(150)
  })
})

describe('collectParticipants (multi-role dedupe regression)', () => {
  it('one person as both job salesperson and opportunity setter/owner is only counted once', () => {
    const participants = collectParticipants(
      { salesperson_id: 'user-1' },
      { setter_user_id: 'user-1', owner_user_id: 'user-1' }
    )
    expect(participants).toEqual([{ userId: 'user-1', role: 'sales_rep' }])
  })

  it('distinct setter and owner both included alongside a different salesperson', () => {
    const participants = collectParticipants(
      { salesperson_id: 'user-1' },
      { setter_user_id: 'user-2', owner_user_id: 'user-3' }
    )
    expect(participants).toEqual([
      { userId: 'user-1', role: 'sales_rep' },
      { userId: 'user-2', role: 'setter' },
      { userId: 'user-3', role: 'owner' },
    ])
  })
})
