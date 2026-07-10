import {
  cadenceDaysForAttempts,
  comparePriority,
  getQueuePriority,
  getQueueStory,
  shouldAutoRetire,
  suggestedNextAttemptDays,
} from '@/lib/inside-sales-priority'

const NOW = new Date('2026-07-10T15:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString()
}

const base = {
  followUpKind: 'handoff' as const,
  callableNow: true,
  followUpAt: null,
  eligibleAtIso: null,
  enteredQueueAt: iso(-10 * DAY),
  attemptCount: 0,
  lastAttemptAt: null,
}

describe('getQueuePriority', () => {
  it('puts overdue scheduled follow-ups in tier 1, most overdue first', () => {
    const a = getQueuePriority({ ...base, followUpAt: iso(-5 * DAY) }, NOW)
    const b = getQueuePriority({ ...base, followUpAt: iso(-1 * DAY) }, NOW)
    expect(a.tier).toBe(1)
    expect(b.tier).toBe(1)
    expect(comparePriority(a, b)).toBeLessThan(0)
  })

  it('treats a follow-up due exactly now as due', () => {
    expect(getQueuePriority({ ...base, followUpAt: iso(0) }, NOW).tier).toBe(1)
  })

  it('puts fresh never-attempted leads in tier 2, newest first', () => {
    const newer = getQueuePriority(
      { ...base, enteredQueueAt: iso(-2 * 60 * 60 * 1000) },
      NOW
    )
    const older = getQueuePriority(
      { ...base, enteredQueueAt: iso(-40 * 60 * 60 * 1000) },
      NOW
    )
    expect(newer.tier).toBe(2)
    expect(older.tier).toBe(2)
    expect(comparePriority(newer, older)).toBeLessThan(0)
  })

  it('uses eligibleAtIso over enteredQueueAt for freshness (rep grace ended recently)', () => {
    const p = getQueuePriority(
      { ...base, enteredQueueAt: iso(-30 * DAY), eligibleAtIso: iso(-1 * DAY) },
      NOW
    )
    expect(p.tier).toBe(2)
  })

  it('puts never-attempted backlog in tier 3, oldest first', () => {
    const older = getQueuePriority({ ...base, enteredQueueAt: iso(-90 * DAY) }, NOW)
    const newer = getQueuePriority({ ...base, enteredQueueAt: iso(-10 * DAY) }, NOW)
    expect(older.tier).toBe(3)
    expect(newer.tier).toBe(3)
    expect(comparePriority(older, newer)).toBeLessThan(0)
  })

  it('puts attempted leads whose cadence elapsed in tier 4, longest-quiet first', () => {
    const quiet = getQueuePriority(
      { ...base, attemptCount: 2, lastAttemptAt: iso(-9 * DAY) },
      NOW
    )
    const recent = getQueuePriority(
      { ...base, attemptCount: 2, lastAttemptAt: iso(-3 * DAY) },
      NOW
    )
    expect(quiet.tier).toBe(4)
    expect(recent.tier).toBe(4)
    expect(comparePriority(quiet, recent)).toBeLessThan(0)
  })

  it('parks attempted leads still inside cadence in tier 5', () => {
    const p = getQueuePriority(
      { ...base, attemptCount: 3, lastAttemptAt: iso(-1 * DAY) },
      NOW
    )
    expect(p.tier).toBe(5)
  })

  it('sinks future scheduled follow-ups to tier 6, soonest first', () => {
    const soon = getQueuePriority({ ...base, followUpAt: iso(1 * DAY) }, NOW)
    const later = getQueuePriority({ ...base, followUpAt: iso(5 * DAY) }, NOW)
    expect(soon.tier).toBe(6)
    expect(comparePriority(soon, later)).toBeLessThan(0)
  })

  it('sinks not-yet-callable (rep grace) to tier 7 regardless of follow-up', () => {
    const p = getQueuePriority(
      { ...base, callableNow: false, eligibleAtIso: iso(2 * DAY), followUpAt: iso(-1 * DAY) },
      NOW
    )
    expect(p.tier).toBe(7)
  })
})

describe('cadenceDaysForAttempts', () => {
  it('decays and clamps at the last step', () => {
    expect(cadenceDaysForAttempts(1)).toBe(1)
    expect(cadenceDaysForAttempts(2)).toBe(2)
    expect(cadenceDaysForAttempts(6)).toBe(10)
    expect(cadenceDaysForAttempts(20)).toBe(10)
    expect(cadenceDaysForAttempts(0)).toBe(0)
  })
})

describe('getQueueStory', () => {
  const storyBase = {
    followUpKind: 'handoff' as const,
    outcomeId: null as string | null,
    outcomeLabel: null as string | null,
    knockbackReason: null as string | null,
    enteredQueueAt: iso(-3 * DAY),
    handoffContext: null,
  }

  it('tells the insurance story with claim context and adjusts the objective', () => {
    const noClaim = getQueueStory({
      ...storyBase,
      outcomeId: 'insurance_follow_up',
      handoffContext: { claim_filed: 'no' },
    })
    expect(noClaim.story).toContain('NOT filed')
    expect(noClaim.objective).toContain('claim')

    const withAdjuster = getQueueStory({
      ...storyBase,
      outcomeId: 'insurance_follow_up',
      handoffContext: {
        claim_filed: 'yes',
        insurance_carrier: 'State Farm',
        adjuster_meeting_at: iso(4 * DAY),
      },
    })
    expect(withAdjuster.story).toContain('State Farm')
    expect(withAdjuster.objective).toContain('adjuster')
  })

  it('maps didnt_sit to a rebook objective', () => {
    const s = getQueueStory({ ...storyBase, followUpKind: 'didnt_sit' })
    expect(s.story).toContain('did not sit')
    expect(s.objective).toBe('Rebook the inspection')
  })

  it('maps knockback reasons', () => {
    const s = getQueueStory({
      ...storyBase,
      followUpKind: 'knockback',
      knockbackReason: 'credit_fail',
    })
    expect(s.story).toContain('financing')
  })

  it('recognizes cancelled-at-door custom outcomes by label', () => {
    const s = getQueueStory({
      ...storyBase,
      outcomeId: 'outcome_1774467567968',
      outcomeLabel: "Cancelled At Door/Didn't Pitch",
    })
    expect(s.story).toContain('cancelled at the door')
    expect(s.objective).toBe('Rebook the inspection')
  })
})

describe('suggestedNextAttemptDays', () => {
  it('suggests short retries for non-contact results only', () => {
    expect(suggestedNextAttemptDays('No Answer')).toBe(2)
    expect(suggestedNextAttemptDays('Left Voicemail')).toBe(3)
    expect(suggestedNextAttemptDays('Spoke with them')).toBeNull()
    expect(suggestedNextAttemptDays('Wrong number')).toBeNull()
    expect(suggestedNextAttemptDays('Not Interested')).toBeNull()
  })
})

describe('shouldAutoRetire', () => {
  it('never retires never-attempted leads', () => {
    expect(
      shouldAutoRetire({ attemptCount: 0, lastAttemptAt: null, followUpAt: null }, NOW)
    ).toBe(false)
  })

  it('retires after 6 quiet attempts with no future follow-up', () => {
    expect(
      shouldAutoRetire(
        { attemptCount: 6, lastAttemptAt: iso(-8 * DAY), followUpAt: null },
        NOW
      )
    ).toBe(true)
  })

  it('does not retire when a future follow-up is scheduled', () => {
    expect(
      shouldAutoRetire(
        { attemptCount: 8, lastAttemptAt: iso(-30 * DAY), followUpAt: iso(2 * DAY) },
        NOW
      )
    ).toBe(false)
  })

  it('does not retire when an overdue follow-up callback is still scheduled', () => {
    expect(
      shouldAutoRetire(
        { attemptCount: 8, lastAttemptAt: iso(-30 * DAY), followUpAt: iso(-2 * DAY) },
        NOW
      )
    ).toBe(false)
  })

  it('does not retire while attempts are recent', () => {
    expect(
      shouldAutoRetire(
        { attemptCount: 6, lastAttemptAt: iso(-2 * DAY), followUpAt: null },
        NOW
      )
    ).toBe(false)
  })
})
