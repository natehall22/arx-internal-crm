import {
  calendarDaySpan,
  deriveJobSchedule,
  detectTradesFromLineItems,
  formatInstallDays,
  newCrewLinkToken,
  parseInstallDays,
  primaryTradeForJobType,
  sortTrades,
} from '@/lib/job-trades'
import { isCrewLinkExpired } from '@/lib/crew-link'
import { missingRequiredPhotoTags } from '@/lib/final-photo-tags'

describe('crew length', () => {
  it('accepts only ½, 1, 1½ and 2 days', () => {
    expect([0.5, 1, 1.5, 2, '1.5'].map(parseInstallDays)).toEqual([0.5, 1, 1.5, 2, 1.5])
    expect([0, 3, 0.25, 'x', null, undefined].map(parseInstallDays)).toEqual([null, null, null, null, null, null])
  })

  it('touches one calendar date for ½ and 1 day, two for 1½ and 2', () => {
    expect([0.5, 1, 1.5, 2, null].map(calendarDaySpan)).toEqual([1, 1, 2, 2, 1])
  })

  it('labels lengths the way ops says them', () => {
    expect([0.5, 1, 1.5, 2].map(formatInstallDays)).toEqual(['½ day', '1 day', '1½ days', '2 days'])
  })
})

describe('detectTradesFromLineItems', () => {
  it('finds gutters and siding from sold line items (26-0026 shape)', () => {
    expect(
      detectTradesFromLineItems([
        { name: 'Asphalt Shingles Installation', category: 'Roofing' },
        { name: '6" Seamless Gutters', category: 'addons' },
        { name: 'Vinyl Siding', category: 'addons' },
        { name: '1" x 8" Primed Facia Board', category: 'addons' },
      ])
    ).toEqual(['gutters', 'siding'])
  })

  it('does not treat fascia, soffit or roofing adders as a separate crew', () => {
    expect(
      detectTradesFromLineItems([
        { name: 'Premier Pricing', category: 'addons' },
        { name: 'Soffit replacement', category: 'addons' },
        { name: '1 Layer Tear Off', category: 'Tear-off' },
      ])
    ).toEqual([])
  })

  it('matches downspouts as gutters', () => {
    expect(detectTradesFromLineItems([{ name: 'Downspout extension' }])).toEqual(['gutters'])
  })
})

describe('primaryTradeForJobType', () => {
  it('maps job types, defaulting mixed/unknown to roofing', () => {
    expect(['roofing', 'mixed', null, 'siding', 'gutters'].map(primaryTradeForJobType)).toEqual([
      'roofing',
      'roofing',
      'roofing',
      'siding',
      'gutters',
    ])
  })
})

describe('deriveJobSchedule', () => {
  const t = (over: Record<string, unknown>) => ({
    trade: 'roofing' as const,
    status: 'scheduled',
    assigned_sub_id: 'sub-roof',
    scheduled_date: '2026-09-18',
    install_days: 1,
    ...over,
  })

  it('uses the earliest crew date and the roofing crew as the job sub', () => {
    const d = deriveJobSchedule({ status: 'sold' }, [
      t({ trade: 'gutters', assigned_sub_id: 'sub-gut', scheduled_date: '2026-09-16' }),
      t({}),
    ] as never)
    expect(d.scheduled_date).toBe('2026-09-16')
    expect(d.assigned_sub_id).toBe('sub-roof')
    expect(d.status).toBe('scheduled')
  })

  it('falls back to the earliest crew sub when roofing is not booked', () => {
    const d = deriveJobSchedule({ status: 'materials' }, [
      t({ trade: 'siding', assigned_sub_id: 'sub-side', scheduled_date: '2026-09-20' }),
      t({ status: 'pending', assigned_sub_id: null, scheduled_date: null }),
    ] as never)
    expect(d.assigned_sub_id).toBe('sub-side')
    expect(d.install_days).toBe(1)
  })

  it('moves the job to in progress once one crew is done and another is not', () => {
    const d = deriveJobSchedule({ status: 'scheduled' }, [t({ status: 'completed' }), t({ trade: 'gutters' })] as never)
    expect(d.status).toBe('in_progress')
  })

  it('moves a single-crew job to in progress when that crew is done, but never completes it — that starts payroll', () => {
    expect(deriveJobSchedule({ status: 'scheduled' }, [t({ status: 'completed' })] as never).status).toBe('in_progress')
    expect(deriveJobSchedule({ status: 'in_progress' }, [t({ status: 'completed' })] as never).status).toBe('in_progress')
  })

  it('does not touch on-hold, complete or collected jobs', () => {
    for (const status of ['on_hold', 'complete', 'collected']) {
      expect(deriveJobSchedule({ status }, [] as never).status).toBe(status)
    }
  })

  it('only reverts scheduled → materials when a booking was just removed', () => {
    const pendingOnly = [t({ status: 'pending', assigned_sub_id: null, scheduled_date: null })] as never
    expect(deriveJobSchedule({ status: 'scheduled' }, pendingOnly).status).toBe('scheduled')
    expect(deriveJobSchedule({ status: 'scheduled' }, pendingOnly, { revertToMaterials: true }).status).toBe('materials')
  })

  it('ignores removed crews', () => {
    const d = deriveJobSchedule({ status: 'scheduled' }, [t({ status: 'cancelled' })] as never, { revertToMaterials: true })
    expect(d.scheduled_date).toBeNull()
    expect(d.assigned_sub_id).toBeNull()
    expect(d.status).toBe('materials')
  })

  it('reports a 1½-day earliest crew as a 2-day job span (integer column)', () => {
    expect(deriveJobSchedule({ status: 'sold' }, [t({ install_days: 1.5 })] as never).install_days).toBe(2)
  })
})

describe('sortTrades', () => {
  it('orders roofing, gutters, siding, then by creation', () => {
    const rows = [
      { trade: 'siding' as const, created_at: '2026-09-01' },
      { trade: 'roofing' as const, created_at: '2026-09-02' },
      { trade: 'gutters' as const, created_at: '2026-09-03' },
    ]
    expect(sortTrades(rows).map((r) => r.trade)).toEqual(['roofing', 'gutters', 'siding'])
  })
})

describe('crew photo link', () => {
  it('generates unguessable URL-safe tokens', () => {
    const a = newCrewLinkToken()
    const b = newCrewLinkToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(a).not.toBe(b)
  })

  it('stays valid for 30 days after the crew’s last day, then expires', () => {
    // 2-day crew starting Sep 18 → last day Sep 19 → valid through Oct 19.
    expect(isCrewLinkExpired('2026-09-18', 2, '2026-10-19')).toBe(false)
    expect(isCrewLinkExpired('2026-09-18', 2, '2026-10-20')).toBe(true)
    expect(isCrewLinkExpired('2026-09-18', 0.5, '2026-10-18')).toBe(false)
    expect(isCrewLinkExpired('2026-09-18', 0.5, '2026-10-19')).toBe(true)
  })

  it('lists which of the 4 walk-around photos are still missing', () => {
    expect(missingRequiredPhotoTags(['final_front', 'other_final', null, 'final_back'])).toEqual([
      'final_left',
      'final_right',
    ])
  })
})
