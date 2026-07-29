import {
  buildIlikeFilterValue,
  formatOpportunityDetail,
  isReferralLinkTargetType,
  rankAndDedupeLinkTargets,
  referralLinkColumns,
  referralUnlinkColumns,
  type ReferralLinkTarget,
} from '@/lib/referral-links'

const OPPORTUNITY_ID = '550e8400-e29b-41d4-a716-446655440000'
const CUSTOMER_ID = '550e8400-e29b-41d4-a716-446655440001'
const LEAD_ID = '550e8400-e29b-41d4-a716-446655440002'

function target(overrides: Partial<ReferralLinkTarget> = {}): ReferralLinkTarget {
  return {
    id: OPPORTUNITY_ID,
    type: 'opportunity',
    name: 'Quinn Shay',
    detail: null,
    phone: null,
    email: null,
    address: null,
    ...overrides,
  }
}

describe('isReferralLinkTargetType', () => {
  it('accepts the three linkable record types', () => {
    expect(isReferralLinkTargetType('opportunity')).toBe(true)
    expect(isReferralLinkTargetType('customer')).toBe(true)
    expect(isReferralLinkTargetType('lead')).toBe(true)
  })

  it('rejects anything else, including project and non-strings', () => {
    expect(isReferralLinkTargetType('project')).toBe(false)
    expect(isReferralLinkTargetType('')).toBe(false)
    expect(isReferralLinkTargetType(null)).toBe(false)
    expect(isReferralLinkTargetType(undefined)).toBe(false)
    expect(isReferralLinkTargetType(7)).toBe(false)
  })
})

describe('referralLinkColumns', () => {
  it('sets only the column for the chosen type', () => {
    expect(referralLinkColumns({ id: OPPORTUNITY_ID, type: 'opportunity' })).toEqual({
      referred_opportunity_id: OPPORTUNITY_ID,
    })
    expect(referralLinkColumns({ id: CUSTOMER_ID, type: 'customer' })).toEqual({
      referred_customer_id: CUSTOMER_ID,
    })
    expect(referralLinkColumns({ id: LEAD_ID, type: 'lead' })).toEqual({
      referred_lead_id: LEAD_ID,
    })
  })
})

describe('referralUnlinkColumns', () => {
  it('clears every link column so no stale id survives a re-link', () => {
    expect(referralUnlinkColumns()).toEqual({
      referred_opportunity_id: null,
      referred_customer_id: null,
      referred_lead_id: null,
      referred_project_id: null,
    })
  })

  it('is overridden cleanly by a following link, leaving one id set', () => {
    const merged = {
      ...referralUnlinkColumns(),
      ...referralLinkColumns({ id: OPPORTUNITY_ID, type: 'opportunity' }),
    }
    expect(merged).toEqual({
      referred_opportunity_id: OPPORTUNITY_ID,
      referred_customer_id: null,
      referred_lead_id: null,
      referred_project_id: null,
    })
  })
})

describe('buildIlikeFilterValue', () => {
  it('wraps the term in quoted %…% so it is a substring match', () => {
    expect(buildIlikeFilterValue('9917 Brigstock Ct')).toBe('"%9917 Brigstock Ct%"')
  })

  it('quotes rather than escapes commas and parens, which or() splits on', () => {
    expect(buildIlikeFilterValue('Smith, John')).toBe('"%Smith, John%"')
    expect(buildIlikeFilterValue('Shay (rental)')).toBe('"%Shay (rental)%"')
  })

  it('strips LIKE wildcards instead of escaping them, since \\% is not honoured', () => {
    expect(buildIlikeFilterValue('100%')).toBe('"%100 %"')
    expect(buildIlikeFilterValue('a_b')).toBe('"%a b%"')
    // A lone % must not survive as a match-all wildcard.
    expect(buildIlikeFilterValue('%')).not.toContain('%%%')
  })

  it('escapes quotes and backslashes so the value cannot break out of its quoting', () => {
    expect(buildIlikeFilterValue('say "hi"')).toBe('"%say \\"hi\\"%"')
    expect(buildIlikeFilterValue('a\\b')).toBe('"%a\\\\b%"')
  })

  it('escapes a trailing backslash that would otherwise consume the closing quote', () => {
    expect(buildIlikeFilterValue('a\\')).toBe('"%a\\\\%"')
  })

  it('cannot inject an extra or() operand by closing the quoted value', () => {
    // Unescaped, this reached PostgREST as a real filter and errored on `status`.
    const value = buildIlikeFilterValue('x",status.eq.paid,name.ilike."y')
    expect(value).toBe('"%x\\",status.eq.paid,name.ilike.\\"y%"')
    // Exactly two unescaped quotes remain: the wrapping pair.
    expect(value.match(/(?<!\\)"/g)).toHaveLength(2)
  })
})

describe('formatOpportunityDetail', () => {
  it('joins address, status and type, humanizing underscores', () => {
    expect(
      formatOpportunityDetail({
        address_text: '9917 Brigstock Ct',
        status: 'in_progress',
        project_type: 'roofing',
      })
    ).toBe('9917 Brigstock Ct • in progress • roofing')
  })

  it('skips missing parts rather than leaving empty separators', () => {
    expect(formatOpportunityDetail({ address_text: null, status: 'open', project_type: null })).toBe('open')
  })

  it('returns null when there is nothing to show', () => {
    expect(formatOpportunityDetail({})).toBeNull()
    expect(formatOpportunityDetail({ address_text: null, status: null, project_type: null })).toBeNull()
  })
})

describe('rankAndDedupeLinkTargets', () => {
  it('puts name-prefix matches ahead of incidental ones', () => {
    const results = rankAndDedupeLinkTargets(
      [
        target({ id: CUSTOMER_ID, type: 'customer', name: 'Bob Quinnley' }),
        target({ id: LEAD_ID, type: 'lead', name: 'Quinn Shay' }),
      ],
      'quinn'
    )
    expect(results.map((r) => r.name)).toEqual(['Quinn Shay', 'Bob Quinnley'])
  })

  it('ranks opportunity above customer above lead on an equal name match', () => {
    const results = rankAndDedupeLinkTargets(
      [
        target({ id: LEAD_ID, type: 'lead', name: 'Quinn Shay' }),
        target({ id: CUSTOMER_ID, type: 'customer', name: 'Quinn Shay' }),
        target({ id: OPPORTUNITY_ID, type: 'opportunity', name: 'Quinn Shay' }),
      ],
      'quinn'
    )
    expect(results.map((r) => r.type)).toEqual(['opportunity', 'customer', 'lead'])
  })

  it('keeps the same id when it appears as different record types', () => {
    const sharedId = OPPORTUNITY_ID
    const results = rankAndDedupeLinkTargets(
      [
        target({ id: sharedId, type: 'opportunity', name: 'Quinn Shay' }),
        target({ id: sharedId, type: 'customer', name: 'Quinn Shay' }),
      ],
      'quinn'
    )
    expect(results).toHaveLength(2)
  })

  it('drops a duplicate of the same type and id', () => {
    const results = rankAndDedupeLinkTargets(
      [
        target({ name: 'Quinn Shay' }),
        target({ name: 'Quinn Shay' }),
      ],
      'quinn'
    )
    expect(results).toHaveLength(1)
  })

  it('does not mutate the caller’s array', () => {
    const input = [
      target({ id: LEAD_ID, type: 'lead', name: 'Zed' }),
      target({ id: OPPORTUNITY_ID, type: 'opportunity', name: 'Abe' }),
    ]
    const before = input.map((t) => t.id)
    rankAndDedupeLinkTargets(input, 'abe')
    expect(input.map((t) => t.id)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(rankAndDedupeLinkTargets([], 'quinn')).toEqual([])
  })
})
