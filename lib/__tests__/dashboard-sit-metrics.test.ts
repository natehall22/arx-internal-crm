import {
  countSitsByOwner,
  countSitsBySetter,
  countSitsScoped,
  type EffectiveSitOpportunity,
} from '@/lib/dashboard-sit-metrics'

const sampleSits: EffectiveSitOpportunity[] = [
  {
    id: 'opp-1',
    lead_id: 'lead-1',
    setter_user_id: 'setter-a',
    owner_user_id: 'closer-a',
    inspection_outcome: 'moving_to_close',
    inspection_outcome_at: '2026-05-29T20:03:06.798Z',
  },
  {
    id: 'opp-2',
    lead_id: 'lead-2',
    setter_user_id: 'setter-a',
    owner_user_id: 'closer-a',
    inspection_outcome: 'insurance_follow_up',
    inspection_outcome_at: '2026-05-26T19:48:47.691Z',
  },
  {
    id: 'opp-3',
    lead_id: 'lead-3',
    setter_user_id: 'setter-b',
    owner_user_id: 'closer-a',
    inspection_outcome: 'insurance_follow_up',
    inspection_outcome_at: '2026-05-28T12:00:00.000Z',
  },
]

describe('dashboard-sit-metrics attribution', () => {
  it('counts sits per setter', () => {
    const counts = countSitsBySetter(sampleSits, ['setter-a', 'setter-b', 'closer-a'])
    expect(counts.get('setter-a')).toBe(2)
    expect(counts.get('setter-b')).toBe(1)
    expect(counts.get('closer-a')).toBeUndefined()
  })

  it('counts sits per closer owner', () => {
    const counts = countSitsByOwner(sampleSits, ['closer-a', 'setter-a'])
    expect(counts.get('closer-a')).toBe(3)
  })

  it('counts scoped personal sits for setter lane', () => {
    expect(countSitsScoped(sampleSits, ['setter-a'], true)).toBe(2)
    expect(countSitsScoped(sampleSits, ['closer-a'], false)).toBe(3)
    expect(countSitsScoped(sampleSits, [], true)).toBe(3)
  })
})
