/**
 * Each company's own trades list — golden tests: for ARX (seeded with the standard list) nothing may change
 * versus the constants that lived in lib/job-trades.ts before org_trades existed. The FROZEN_* values below
 * are copied from that file (main @ 5dfe3cf9) and must not be edited to make a test pass.
 */
import { readFileSync } from 'fs'
import path from 'path'

import {
  DEFAULT_ORG_TRADES,
  defaultPrimaryTrade,
  detectTradesFromLineItems,
  isAddableTrade,
  loadOrgTrades,
  loadOrgTradesWithSource,
  primaryTradeForJobType,
  slugForNewTrade,
  sortTrades,
  tradeLabel,
  tradeOptions,
  type OrgTrade,
} from '@/lib/org-trades'
import { createFakeDb } from '@/lib/test-helpers/fake-db'

const FROZEN_TRADES = ['roofing', 'gutters', 'siding', 'windows', 'other'] as const
type FrozenTrade = (typeof FROZEN_TRADES)[number]
const FROZEN_TRADE_LABELS: Record<FrozenTrade, string> = { roofing: 'Roofing', gutters: 'Gutters', siding: 'Siding', windows: 'Windows', other: 'Other' }
const FROZEN_PATTERNS: [FrozenTrade, RegExp][] = [
  ['gutters', /gutter|downspout/i],
  ['siding', /siding/i],
  ['windows', /\bwindows?\b/i],
]
function frozenDetect(items: { name?: string | null; category?: string | null }[]): FrozenTrade[] {
  const found = new Set<FrozenTrade>()
  for (const item of items) {
    const text = `${item.name ?? ''} ${item.category ?? ''}`
    for (const [trade, pattern] of FROZEN_PATTERNS) if (pattern.test(text)) found.add(trade)
  }
  return FROZEN_TRADES.filter((t) => found.has(t))
}
function frozenPrimary(jobType: string | null | undefined): FrozenTrade {
  const t = String(jobType ?? '').toLowerCase().trim()
  if (t === 'gutters' || t === 'gutter') return 'gutters'
  if (t === 'siding') return 'siding'
  if (t === 'windows' || t === 'window') return 'windows'
  return 'roofing'
}

const LINE_ITEM_FIXTURES: { name?: string | null; category?: string | null }[][] = [
  [{ name: 'Asphalt Shingles Installation', category: 'Roofing' }, { name: '6" Seamless Gutters', category: 'addons' }, { name: 'Vinyl Siding', category: 'addons' }, { name: '1" x 8" Primed Facia Board', category: 'addons' }],
  [{ name: 'Premier Pricing', category: 'addons' }, { name: 'Soffit replacement', category: 'addons' }, { name: '1 Layer Tear Off', category: 'Tear-off' }],
  [{ name: 'Downspout extension' }],
  [{ name: 'GUTTER GUARDS', category: null }, { name: null, category: 'Siding' }],
  [{ name: 'Replace 3 Windows' }, { name: 'Window' }, { name: 'Windowsill trim' }, { name: 'Bay windows', category: 'addons' }],
  [{ name: 'Skylight', category: 'Skylights' }, { name: 'Ridge vent', category: 'Ventilation' }],
  [{ name: 'Seamless gutters + downspouts' }, { name: 'Hardie siding' }, { name: 'Storm windows' }],
  [],
]

describe('standard list = the old constants (golden)', () => {
  it('slugs, order and labels are identical', () => {
    expect(DEFAULT_ORG_TRADES.map((t) => t.slug)).toEqual([...FROZEN_TRADES])
    for (const t of FROZEN_TRADES) expect(tradeLabel(t)).toBe(FROZEN_TRADE_LABELS[t])
    expect(DEFAULT_ORG_TRADES.every((t) => t.active)).toBe(true)
  })

  it('line-item keyword patterns compile to the same regular expressions', () => {
    for (const [slug, re] of FROZEN_PATTERNS) {
      const kw = DEFAULT_ORG_TRADES.find((t) => t.slug === slug)!.matchKeywords!
      expect(new RegExp(kw.join('|'), 'i').source).toBe(re.source)
    }
    expect(DEFAULT_ORG_TRADES.filter((t) => t.matchKeywords).map((t) => t.slug)).toEqual(FROZEN_PATTERNS.map(([s]) => s))
  })

  it('detectTradesFromLineItems gives the same answer for every fixture', () => {
    for (const items of LINE_ITEM_FIXTURES) expect(detectTradesFromLineItems(items)).toEqual(frozenDetect(items))
  })

  it('primaryTradeForJobType gives the same answer for every job_type the database allowed', () => {
    for (const jt of ['roofing', 'siding', 'windows', 'mixed', 'gutters', null, undefined, '', 'Gutter', ' WINDOW ', 'unknown']) {
      expect(primaryTradeForJobType(jt)).toBe(frozenPrimary(jt))
    }
  })

  it('sortTrades keeps the fixed trade order, then creation time', () => {
    const rows = [
      { trade: 'other', created_at: '2026-01-01' },
      { trade: 'siding', created_at: '2026-01-02' },
      { trade: 'roofing', created_at: '2026-01-03' },
      { trade: 'siding', created_at: '2026-01-01' },
      { trade: 'gutters', created_at: '2026-01-05' },
    ]
    expect(sortTrades(rows)).toEqual([...rows].sort((a, b) => FROZEN_TRADES.indexOf(a.trade as FrozenTrade) - FROZEN_TRADES.indexOf(b.trade as FrozenTrade) || a.created_at.localeCompare(b.created_at)))
  })
})

describe('migration seed = DEFAULT_ORG_TRADES', () => {
  it('seeds exactly the standard list (slug, label, sort, active, keywords)', () => {
    const sql = readFileSync(path.join(process.cwd(), 'supabase/migrations/202611060020_org_trades.sql'), 'utf8')
    const rows = Array.from(sql.matchAll(/\(p_org_id, '([a-z_]+)',\s*'([^']+)',\s*(\d+), (TRUE|FALSE), (NULL|ARRAY\[[^\]]*\])\)/g)).map((m) => ({
      slug: m[1],
      label: m[2],
      sort: Number(m[3]),
      active: m[4] === 'TRUE',
      matchKeywords: m[5] === 'NULL' ? null : Array.from(m[5].matchAll(/'([^']*)'/g)).map((k) => k[1]),
    }))
    expect(rows).toEqual(DEFAULT_ORG_TRADES.map((t) => ({ ...t })))
  })
})

describe("a company's own list", () => {
  const custom: OrgTrade[] = [
    { slug: 'siding', label: 'Exterior cladding', sort: 5, active: true, matchKeywords: ['siding', 'hardie'] },
    { slug: 'roofing', label: 'Roofing', sort: 10, active: true, matchKeywords: null },
    { slug: 'gutters', label: 'Gutters', sort: 20, active: false, matchKeywords: ['gutter'] },
    { slug: 'solar', label: 'Solar R&R', sort: 30, active: true, matchKeywords: ['solar'] },
  ]

  it('labels, detection, primary and order follow the company list; inactive trades are not detected or addable', () => {
    expect(tradeLabel('siding', custom)).toBe('Exterior cladding')
    expect(tradeLabel('electrical', custom)).toBe('Electrical')
    expect(detectTradesFromLineItems([{ name: 'Seamless gutters' }, { name: 'Hardie board' }, { name: 'Solar panel R&R' }], custom)).toEqual(['siding', 'solar'])
    expect(primaryTradeForJobType('mixed', custom)).toBe('siding')
    expect(primaryTradeForJobType('gutters', custom)).toBe('gutters') // existing job type keeps its crew even when the trade is off
    expect(defaultPrimaryTrade(custom)).toBe('siding')
    expect(isAddableTrade('gutters', custom)).toBe(false)
    expect(isAddableTrade('solar', custom)).toBe(true)
    expect(isAddableTrade('plumbing', custom)).toBe(false)
    expect(sortTrades([{ trade: 'roofing', created_at: 'a' }, { trade: 'zzz', created_at: 'a' }, { trade: 'siding', created_at: 'a' }], custom).map((r) => r.trade)).toEqual(['siding', 'roofing', 'zzz'])
    expect(tradeOptions(custom).map((t) => t.slug)).toEqual(['siding', 'roofing', 'gutters', 'solar'])
  })

  it('a bad keyword pattern is skipped, never thrown', () => {
    expect(detectTradesFromLineItems([{ name: 'x' }], [{ slug: 'a', label: 'A', sort: 1, active: true, matchKeywords: ['('] }])).toEqual([])
  })

  it('new slugs come from the label, avoid taken slugs and never use "mixed"', () => {
    expect(slugForNewTrade('Solar panels', [])).toBe('solar_panels')
    expect(slugForNewTrade('Roofing', ['roofing'])).toBe('roofing_2')
    expect(slugForNewTrade('Mixed', [])).toBe('mixed_2')
    expect(slugForNewTrade('2nd story', [])).toBe('t_2nd_story')
    expect(slugForNewTrade('!!!', [])).toBeNull()
  })
})

describe('loadOrgTrades', () => {
  it('reads the org rows, cached per client', async () => {
    const db = createFakeDb({
      org_trades: [
        { org_id: 'org-1', slug: 'roofing', label: 'Roof', sort: 10, active: true, match_keywords: null },
        { org_id: 'org-2', slug: 'gutters', label: 'Gutters', sort: 10, active: true, match_keywords: ['gutter'] },
      ],
    })
    const first = await loadOrgTradesWithSource(db.client, 'org-1')
    expect(first.source).toBe('table')
    expect(first.trades.map((t) => t.label)).toEqual(['Roof'])
    db.tables.org_trades[0].label = 'Changed'
    expect((await loadOrgTrades(db.client, 'org-1'))[0].label).toBe('Roof')
  })

  it('falls back to the standard list when the table is missing or the org has no rows', async () => {
    const missing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code: '42P01', message: 'relation "org_trades" does not exist' } }) }) }) }
    expect(await loadOrgTradesWithSource(missing as never, 'org-1')).toEqual({ trades: DEFAULT_ORG_TRADES.map((t) => ({ ...t })), source: 'default' })
    const empty = createFakeDb({ org_trades: [] })
    expect((await loadOrgTradesWithSource(empty.client, 'org-1')).source).toBe('default')
  })
})
