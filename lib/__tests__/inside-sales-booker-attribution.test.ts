import {
  countsAsInsideSalesSitCredit,
  excludeCreditsAlreadyPaidAsSetterSit,
  filterInsideSalesCreditsToPeriod,
  loadInsideSalesSitCreditsForUser,
  pickFirstQualifyingInsideSalesCredits,
  resolveInsideSalesSitCreditConfig,
  type InsideSalesBookedAppointmentRow,
} from '@/lib/inside-sales-booker-attribution'

const CUTOFF = '2026-08-01'
const RODA = 'user-roda'
const EVAN = 'user-evan'

function appt(
  over: Partial<InsideSalesBookedAppointmentRow> & { id: string }
): InsideSalesBookedAppointmentRow {
  return {
    opportunity_id: 'opp-1',
    lead_id: 'lead-1',
    appointment_type: 'insurance_call',
    status: 'completed',
    scheduled_for: '2026-08-08T12:00:00.000Z',
    inside_sales_booked_by_user_id: RODA,
    inside_sales_sit_credit_excluded: false,
    ...over,
  }
}

describe('resolveInsideSalesSitCreditConfig', () => {
  it('is disabled by default so live payroll does not change on deploy', () => {
    expect(resolveInsideSalesSitCreditConfig(null)).toEqual({ enabled: false, effectiveFrom: null })
    expect(resolveInsideSalesSitCreditConfig({})).toEqual({ enabled: false, effectiveFrom: null })
  })

  it('stays disabled when enabled but no cutoff date is set', () => {
    expect(
      resolveInsideSalesSitCreditConfig({
        inside_sales_sit_credit_enabled: true,
        inside_sales_sit_credit_effective_from: null,
      })
    ).toEqual({ enabled: false, effectiveFrom: null })
  })

  it('stays disabled when the cutoff date is unparseable', () => {
    expect(
      resolveInsideSalesSitCreditConfig({
        inside_sales_sit_credit_enabled: true,
        inside_sales_sit_credit_effective_from: 'not-a-date',
      })
    ).toEqual({ enabled: false, effectiveFrom: null })
  })

  it('enables only when both the switch and the cutoff are set', () => {
    expect(
      resolveInsideSalesSitCreditConfig({
        inside_sales_sit_credit_enabled: true,
        inside_sales_sit_credit_effective_from: '2026-08-01',
      })
    ).toEqual({ enabled: true, effectiveFrom: '2026-08-01' })
  })
})

describe('countsAsInsideSalesSitCredit', () => {
  it('credits a completed insurance appointment stamped with an inside-sales booker', () => {
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1' }), CUTOFF)).toBe(true)
  })

  it('never credits an appointment with no inside-sales booker', () => {
    // This is the Author Jones shape before the fix: canvasser_user_id is the
    // setter, and nothing records who re-booked it.
    expect(
      countsAsInsideSalesSitCredit(
        appt({ id: 'a1', inside_sales_booked_by_user_id: null }),
        CUTOFF
      )
    ).toBe(false)
  })

  it('does not pay for merely booking — the appointment must have happened', () => {
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', status: 'scheduled' }), CUTOFF)).toBe(false)
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', status: 'cancelled' }), CUTOFF)).toBe(false)
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', status: 'no_show' }), CUTOFF)).toBe(false)
  })

  it('honours the admin per-appointment exclusion', () => {
    expect(
      countsAsInsideSalesSitCredit(
        appt({ id: 'a1', inside_sales_sit_credit_excluded: true }),
        CUTOFF
      )
    ).toBe(false)
  })

  it('credits only the types inside sales actually books', () => {
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', appointment_type: 'adjuster_meeting' }), CUTOFF)).toBe(true)
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', appointment_type: 'insurance_call' }), CUTOFF)).toBe(true)
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', appointment_type: 'inspection' }), CUTOFF)).toBe(false)
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', appointment_type: 'close' }), CUTOFF)).toBe(false)
    // Closer-booked at the inspection, not by inside sales — crediting it would pay
    // the inside rep for a booking they did not make.
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1', appointment_type: 'insurance_follow_up' }), CUTOFF)).toBe(false)
  })

  it('protects already-paid periods: nothing before the cutoff is payable', () => {
    expect(
      countsAsInsideSalesSitCredit(
        appt({ id: 'a1', scheduled_for: '2026-07-31T23:59:00.000Z' }),
        CUTOFF
      )
    ).toBe(false)
  })

  it('uses the Eastern calendar date at the effective-date boundary', () => {
    expect(
      countsAsInsideSalesSitCredit(
        appt({ id: 'a1', scheduled_for: '2026-08-06T01:00:00.000Z' }),
        '2026-08-06'
      )
    ).toBe(false)
    expect(
      countsAsInsideSalesSitCredit(
        appt({ id: 'a2', scheduled_for: '2026-08-06T04:00:00.000Z' }),
        '2026-08-06'
      )
    ).toBe(true)
  })

  it('pays nothing at all when there is no cutoff (fail closed)', () => {
    expect(countsAsInsideSalesSitCredit(appt({ id: 'a1' }), null)).toBe(false)
  })
})

describe('pickFirstQualifyingInsideSalesCredits', () => {
  it('pays one credit per opportunity no matter how many times it is re-booked', () => {
    const credits = pickFirstQualifyingInsideSalesCredits(
      [
        appt({ id: 'a3', scheduled_for: '2026-08-20T12:00:00.000Z' }),
        appt({ id: 'a1', scheduled_for: '2026-08-08T12:00:00.000Z' }),
        appt({ id: 'a2', scheduled_for: '2026-08-14T12:00:00.000Z' }),
      ],
      CUTOFF
    )
    expect(credits).toHaveLength(1)
    expect(credits[0].appointmentId).toBe('a1')
    expect(credits[0].eventAt).toBe('2026-08-08T12:00:00.000Z')
  })

  it('pays only the earliest booker when different reps book the same opportunity', () => {
    const credits = pickFirstQualifyingInsideSalesCredits(
      [
        appt({ id: 'a1' }),
        appt({ id: 'a2', inside_sales_booked_by_user_id: EVAN, scheduled_for: '2026-08-09T12:00:00.000Z' }),
      ],
      CUTOFF
    )
    expect(credits.map((c) => c.userId)).toEqual([RODA])
  })

  it('keeps different opportunities separate', () => {
    const credits = pickFirstQualifyingInsideSalesCredits(
      [appt({ id: 'a1', opportunity_id: 'opp-1' }), appt({ id: 'a2', opportunity_id: 'opp-2' })],
      CUTOFF
    )
    expect(credits).toHaveLength(2)
  })

  it('breaks identical-timestamp ties deterministically by appointment id', () => {
    const rows = [appt({ id: 'zzz' }), appt({ id: 'aaa' })]
    expect(pickFirstQualifyingInsideSalesCredits(rows, CUTOFF)[0].appointmentId).toBe('aaa')
    expect(pickFirstQualifyingInsideSalesCredits([...rows].reverse(), CUTOFF)[0].appointmentId).toBe('aaa')
  })

  it('falls back to the lead when the appointment has no opportunity', () => {
    const credits = pickFirstQualifyingInsideSalesCredits(
      [
        appt({ id: 'a1', opportunity_id: null, scheduled_for: '2026-08-08T12:00:00.000Z' }),
        appt({ id: 'a2', opportunity_id: null, scheduled_for: '2026-08-14T12:00:00.000Z' }),
      ],
      CUTOFF
    )
    expect(credits).toHaveLength(1)
    expect(credits[0].appointmentId).toBe('a1')
    expect(credits[0].opportunityId).toBeNull()
  })

  it('drops non-qualifying rows entirely', () => {
    expect(
      pickFirstQualifyingInsideSalesCredits(
        [appt({ id: 'a1', status: 'scheduled' }), appt({ id: 'a2', inside_sales_booked_by_user_id: null })],
        CUTOFF
      )
    ).toEqual([])
  })
})

describe('filterInsideSalesCreditsToPeriod', () => {
  const credits = [
    { appointmentId: 'a1', userId: RODA, opportunityId: 'opp-1', leadId: null, eventAt: '2026-08-08T12:00:00.000Z' },
    { appointmentId: 'a2', userId: RODA, opportunityId: 'opp-2', leadId: null, eventAt: '2026-09-08T12:00:00.000Z' },
  ]

  it('keeps only credits inside the half-open period window', () => {
    const kept = filterInsideSalesCreditsToPeriod(
      credits,
      '2026-08-01T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z'
    )
    expect(kept.map((c) => c.appointmentId)).toEqual(['a1'])
  })

  it('excludes an event exactly on the period end so it cannot pay twice', () => {
    expect(
      filterInsideSalesCreditsToPeriod(
        credits,
        '2026-08-01T00:00:00.000Z',
        '2026-08-08T12:00:00.000Z'
      )
    ).toEqual([])
  })
})

describe('excludeCreditsAlreadyPaidAsSetterSit', () => {
  const credits = [
    { appointmentId: 'a1', userId: RODA, opportunityId: 'opp-1', leadId: null, eventAt: '2026-08-08T12:00:00.000Z' },
    { appointmentId: 'a2', userId: RODA, opportunityId: 'opp-2', leadId: null, eventAt: '2026-08-09T12:00:00.000Z' },
  ]

  it('suppresses a booker credit when the same rep already earned the setter sit', () => {
    // The inside-sales rep is the setter on some of her own opportunities, so one
    // person collecting two sit units on one deal is a real case, not theoretical.
    const kept = excludeCreditsAlreadyPaidAsSetterSit(credits, ['opp-1'])
    expect(kept.map((c) => c.opportunityId)).toEqual(['opp-2'])
  })

  it('leaves credits untouched when the rep earned no setter sits', () => {
    expect(excludeCreditsAlreadyPaidAsSetterSit(credits, [])).toEqual(credits)
  })

  it('never suppresses an orphaned credit that has no opportunity to collide on', () => {
    const orphan = [
      { appointmentId: 'a3', userId: RODA, opportunityId: null, leadId: 'lead-9', eventAt: '2026-08-08T12:00:00.000Z' },
    ]
    expect(excludeCreditsAlreadyPaidAsSetterSit(orphan, ['opp-1'])).toEqual(orphan)
  })
})

describe('loadInsideSalesSitCreditsForUser', () => {
  function makeSupabase(result: { data: unknown; error: unknown }) {
    const order = jest.fn()
    const chain: Record<string, jest.Mock> = {}
    const self: Record<string, unknown> = {}
    for (const key of ['select', 'eq', 'in']) {
      chain[key] = jest.fn(() => self)
    }
    // second .order() resolves the query
    let orderCalls = 0
    chain.order = jest.fn(() => {
      orderCalls += 1
      return orderCalls >= 2 ? Promise.resolve(result) : self
    })
    Object.assign(self, chain)
    return {
      client: { from: jest.fn(() => self) } as never,
      from: (self as { select: jest.Mock }).select,
      order,
    }
  }

  it('does not query at all when the feature is disabled', async () => {
    const supabase = { from: jest.fn() } as never
    const out = await loadInsideSalesSitCreditsForUser(supabase, {
      orgId: 'org-1',
      userId: RODA,
      startIso: '2026-08-01T00:00:00.000Z',
      endIso: '2026-09-01T00:00:00.000Z',
      config: { enabled: false, effectiveFrom: null },
    })
    expect(out).toEqual([])
    expect((supabase as unknown as { from: jest.Mock }).from).not.toHaveBeenCalled()
  })

  it('fails closed by throwing on a query error rather than silently paying nothing', async () => {
    const { client } = makeSupabase({ data: null, error: { message: 'boom' } })
    await expect(
      loadInsideSalesSitCreditsForUser(client, {
        orgId: 'org-1',
        userId: RODA,
        startIso: '2026-08-01T00:00:00.000Z',
        endIso: '2026-09-01T00:00:00.000Z',
        config: { enabled: true, effectiveFrom: CUTOFF },
      })
    ).rejects.toBeTruthy()
  })

  it('returns the in-period credit for a re-booked insurance appointment', async () => {
    const { client } = makeSupabase({
      data: [appt({ id: 'a1' })],
      error: null,
    })
    const out = await loadInsideSalesSitCreditsForUser(client, {
      orgId: 'org-1',
      userId: RODA,
      startIso: '2026-08-01T00:00:00.000Z',
      endIso: '2026-09-01T00:00:00.000Z',
      config: { enabled: true, effectiveFrom: CUTOFF },
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ appointmentId: 'a1', userId: RODA, opportunityId: 'opp-1' })
  })

  it('does not re-pay a credit whose earliest qualifying booking was an earlier period', async () => {
    // Full history is queried on purpose so the earliest-qualifying rule can see
    // the prior period's appointment and suppress the repeat.
    const { client } = makeSupabase({
      data: [
        appt({ id: 'a1', scheduled_for: '2026-08-05T12:00:00.000Z' }),
        appt({ id: 'a2', scheduled_for: '2026-09-15T12:00:00.000Z' }),
      ],
      error: null,
    })
    const out = await loadInsideSalesSitCreditsForUser(client, {
      orgId: 'org-1',
      userId: RODA,
      startIso: '2026-09-01T00:00:00.000Z',
      endIso: '2026-10-01T00:00:00.000Z',
      config: { enabled: true, effectiveFrom: CUTOFF },
    })
    expect(out).toEqual([])
  })
})
