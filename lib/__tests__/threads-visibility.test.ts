import {
  canDeleteMessage, canReadMessage, canReclassify, defaultAudience, looksLikePricing, writableAudiences,
  AUDIENCES, type Audience, type ThreadViewer,
} from '@/lib/threads/visibility'

const base: ThreadViewer = {
  userId: 'u', orgId: 'o', ownerLike: false, jobBoard: false, jobEdit: false, jobFinancials: false, managerLike: false,
  closerLike: false, setterLike: false, pricingBarred: false,
}
const viewers = {
  owner: { ...base, userId: 'owner', ownerLike: true, jobBoard: true, jobEdit: true },
  ops: { ...base, userId: 'ops', jobBoard: true, jobEdit: true },
  manager: { ...base, userId: 'mgr', managerLike: true, jobBoard: true },
  closer: { ...base, userId: 'closer', closerLike: true },
  otherCloser: { ...base, userId: 'closer2', closerLike: true },
  setter: { ...base, userId: 'setter', setterLike: true, pricingBarred: true },
  otherSetter: { ...base, userId: 'setter2', setterLike: true, pricingBarred: true },
  insideSales: { ...base, userId: 'inside', pricingBarred: true, insideSales: true },
  stranger: { ...base, userId: 'sub1' },
}
const deal = { owner_user_id: 'closer', setter_user_id: 'setter' }
const read = (v: ThreadViewer, audience: Audience | null, restricted = false) => canReadMessage(v, deal, { audience, restricted_pricing: restricted })

describe('thread visibility — role × audience', () => {
  it.each([
    // viewer, team, sales, production, crew
    ['owner', true, true, true, true],
    ['ops', true, true, true, true],
    ['manager', true, true, true, true],
    ['closer', true, true, true, true], // own deal
    ['otherCloser', false, false, false, false], // not their deal
    ['setter', true, true, false, false], // setters NEVER see production or crew
    ['otherSetter', false, false, false, false],
    ['insideSales', true, true, false, false],
    ['stranger', false, false, false, false], // unknown role (sub, custom-only): nothing

  ] as const)('%s', (name, team, sales, production, crew) => {
    const v = viewers[name]
    expect([read(v, 'team'), read(v, 'sales'), read(v, 'production'), read(v, 'crew')]).toEqual([team, sales, production, crew])
  })

  it('pricing-flagged messages are hidden from pricing-barred roles whatever the audience', () => {
    for (const a of ['team', 'sales'] as const) {
      expect(read(viewers.setter, a, true)).toBe(false)
      expect(read(viewers.insideSales, a, true)).toBe(false)
      expect(read(viewers.closer, a, true)).toBe(true)
      expect(read(viewers.ops, a, true)).toBe(true)
    }
  })

  it('legacy rows (audience null) keep today\'s org-wide behaviour', () => {
    for (const v of Object.values(viewers)) expect(read(v, null)).toBe(true)
  })

  it('only ops/owners write Crew; setters never write Production', () => {
    expect(writableAudiences(viewers.owner, deal)).toEqual(['team', 'sales', 'production', 'crew'])
    expect(writableAudiences(viewers.ops, deal)).toContain('crew')
    expect(writableAudiences(viewers.closer, deal)).toEqual(['team', 'sales', 'production'])
    expect(writableAudiences(viewers.setter, deal)).toEqual(['team', 'sales'])
    expect(writableAudiences(viewers.otherSetter, deal)).toEqual([])
    expect(writableAudiences(viewers.manager, deal)).not.toContain('crew')
  })

  it('Crew is never the default audience', () => {
    for (const v of [viewers.owner, viewers.ops]) {
      for (const surface of ['sales', 'job', 'overview', 'other'] as const) {
        expect(defaultAudience(v, { surface, lastUsed: 'crew' }, deal)).not.toBe('crew')
      }
    }
  })

  it('defaults: setter → team, ops on Job → production, reply inherits the parent', () => {
    expect(defaultAudience(viewers.setter, { surface: 'job' }, deal)).toBe('team')
    expect(defaultAudience(viewers.ops, { surface: 'job' }, deal)).toBe('production')
    expect(defaultAudience(viewers.closer, { surface: 'sales' }, deal)).toBe('sales')
    expect(defaultAudience(viewers.closer, { surface: 'job', replyTo: { audience: 'sales' } }, deal)).toBe('sales')
    // a setter can't be dragged into a parent audience it may not write
    expect(defaultAudience(viewers.setter, { surface: 'other', replyTo: { audience: 'production' } }, deal)).toBe('team')
  })

  it('delete: author within 15 minutes, owners any time', () => {
    const m = { user_id: 'closer', created_at: new Date(Date.now() - 5 * 60_000).toISOString() }
    const old = { user_id: 'closer', created_at: new Date(Date.now() - 60 * 60_000).toISOString() }
    expect(canDeleteMessage(viewers.closer, m)).toBe(true)
    expect(canDeleteMessage(viewers.closer, old)).toBe(false)
    expect(canDeleteMessage(viewers.owner, old)).toBe(true)
    expect(canDeleteMessage(viewers.setter, m)).toBe(false)
  })

  it('re-classify: ops → production/team, only owners → crew-from-anything else', () => {
    expect(canReclassify(viewers.ops, 'production')).toBe(true)
    expect(canReclassify(viewers.manager, 'crew')).toBe(false)
    expect(canReclassify(viewers.closer, 'sales')).toBe(false)
    expect(canReclassify(viewers.owner, 'crew')).toBe(true)
  })

  it.each(['Signed at $18,400', 'gave her a discount', '10% off', 'commission is 7%', 'financing approved', '28 sq @ 550'])('flags pricing: %s', (t) => {
    expect(looksLikePricing(t)).toBe(true)
  })
  it.each(['Homeowner works nights', 'Gate code 4471', 'Dumpster goes on the street'])('does not flag: %s', (t) => {
    expect(looksLikePricing(t)).toBe(false)
  })
})

describe('the customer audience ("To customer")', () => {
  it('reads exactly like team for every role, with and without the pricing flag', () => {
    for (const [name, v] of Object.entries(viewers)) {
      for (const restricted of [false, true]) expect([name, restricted, read(v, 'customer', restricted)]).toEqual([name, restricted, read(v, 'team', restricted)])
    }
  })
  it('is written by non-field roles only (setters, canvassers, inside sales never email a customer from the thread)', () => {
    for (const name of ['owner', 'ops', 'manager', 'closer'] as const) expect(writableAudiences(viewers[name], deal, true)).toContain('customer')
    for (const name of ['setter', 'insideSales', 'stranger'] as const) expect(writableAudiences(viewers[name], deal, true)).not.toContain('customer')
  })
  it('is offered only when the company uses the portal or automatic customer emails', () => {
    for (const name of ['owner', 'ops', 'manager', 'closer'] as const) expect(writableAudiences(viewers[name], deal, false)).not.toContain('customer')
  })
  it('is never moved onto or off after the fact, by anyone (owners included)', () => {
    for (const v of Object.values(viewers)) {
      for (const to of AUDIENCES) {
        expect(canReclassify(v, 'customer')).toBe(false)
        if (to !== 'customer') expect(canReclassify(v, to, 'customer')).toBe(false)
      }
    }
    expect(canReclassify(viewers.owner, 'production', 'team')).toBe(true) // the rest is unchanged
  })
  it('a reply to a customer-audience message starts as Team — never inherited', () => {
    expect(defaultAudience(viewers.owner, { surface: 'other', replyTo: { audience: 'customer' } }, deal)).toBe('team')
    expect(defaultAudience(viewers.owner, { surface: 'other', replyTo: { audience: 'production' } }, deal)).toBe('production')
  })
  it('the database rule names the same audience set as the app (migration 202611120060)', () => {
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/202611120060_customer_portal.sql'), 'utf8')
    const fn = sql.slice(sql.indexOf('function arx_private.message_visible_to'))
    expect(fn).toContain("p_audience in ('team','sales','customer')")
    expect(fn).toContain("p_audience in ('production','crew')")
    // the checks list every audience the app knows
    const check = (sql.match(/activities_audience_check check \(audience is null or audience in \(([^)]*)\)/) || [])[1] || ''
    expect(check.split(',').map((x) => x.trim().replace(/'/g, '')).sort()).toEqual([...AUDIENCES].sort())
  })
})
