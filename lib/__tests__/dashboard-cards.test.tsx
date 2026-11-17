/** @jest-environment node */
import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))

import CardDashboard from '@/components/dashboard/CardDashboard'
import {
  CLASSIC_CARD_KEYS,
  DASHBOARD_CARDS,
  DASHBOARD_CARD_KEYS,
  cardsForViewer,
  cardsOfferedTo,
  isDrawableCard,
  parseCardsInput,
  readSavedCards,
  resolveDashboard,
  type CardData,
  type DashboardAudience,
} from '@/lib/dashboard-cards'
import { INDUSTRY_PROFILES, INDUSTRY_PROFILE_IDS } from '@/lib/industry-profiles'
import { DEFAULT_ORG_FEATURES } from '@/lib/org-features'
import { resolveOrgProfile } from '@/lib/org-profile'
import { mergeOrgSettings } from '@/lib/org-settings'
import { DATASETS } from '@/lib/reporting/catalog'
import { parseSpec } from '@/lib/reporting/report-spec'
import * as billing from '@/lib/service-billing-db'
import * as plansDb from '@/lib/service-plans-db'
import * as timeDb from '@/lib/time-tracking-db'

const lawn = resolveOrgProfile({ profile: { id: 'lawn_landscape', version: 6 } })
const viewer = (audiences: DashboardAudience[], financials: boolean) => ({ audiences: new Set(audiences), financials })
const lawnList = () => resolveDashboard({}, lawn.dashboard.cards)

describe('catalog: every card reads from an existing source', () => {
  const LOADERS: Record<string, unknown> = { unpaidInvoices: billing.loadUnpaidInvoices, visits: plansDb.loadVisits, servicePlans: plansDb.loadServicePlans, timeWeek: timeDb.loadTimeWeek }

  it('keys are unique and every card has a label and a description', () => {
    expect(new Set(DASHBOARD_CARD_KEYS).size).toBe(DASHBOARD_CARDS.length)
    for (const c of DASHBOARD_CARDS) expect([c.key, c.label.length > 0, c.description.length > 0]).toEqual([c.key, true, true])
  })

  it.each(DASHBOARD_CARDS.map((c) => [c.key, c] as const))('%s names a real source', (_key, c) => {
    const src = c.source
    if (src.kind === 'report') {
      // A report card goes through the one runner: its spec must parse and name a real rpt_* dataset and real columns.
      // The one allowed difference: a leaderboard groups by the dataset's owner (user id) column, which the report builder does not list.
      const ds = DATASETS[src.spec.dataset]
      const perPerson = !!src.spec.groupBy && src.spec.groupBy === ds.ownerColumn
      const parsed = parseSpec(perPerson ? { ...src.spec, groupBy: null } : src.spec)
      expect(parsed.ok).toBe(true)
      expect(src.range === 'week' || src.range === 'spec').toBe(true)
      expect(DATASETS[src.spec.dataset].view).toMatch(/^rpt_/)
    } else if (src.kind === 'loader') {
      // A loader card calls a function that exists today (the one under a Today queue, or a screen's own loader).
      expect(LOADERS).toHaveProperty(src.loader)
      expect(typeof LOADERS[src.loader]).toBe('function')
    } else if (src.kind === 'none') {
      // No source: said out loud, never drawn, never addable.
      expect(src.reason.length).toBeGreaterThan(20)
      expect(isDrawableCard(c)).toBe(false)
    } else {
      expect(CLASSIC_CARD_KEYS).toContain(c.key)
    }
  })

  it('the cards with no existing source are exactly the ones we know of', () => {
    expect(DASHBOARD_CARDS.filter((c) => !isDrawableCard(c)).map((c) => c.key).sort()).toEqual(['cancellations-month', 'mrr', 'quotes-sent-week', 'revenue-per-crew-hour'])
  })

  it('money cards that read the report runner are on finance-gated or own-price columns only', () => {
    for (const c of DASHBOARD_CARDS) {
      const src = c.source
      if (src.kind !== 'report') continue
      const ds = DATASETS[src.spec.dataset]
      const column = 'column' in src.spec.metric ? src.spec.metric.column : null
      const col = column ? ds.columns.find((x) => x.key === column) : undefined
      if (ds.financeOnly || col?.sensitive) expect(c.money).not.toBeNull()
    }
  })
})

describe('industry profiles: starting sets', () => {
  it('roofing and a company with no profile keep the classic dashboard, byte for byte (no card list)', () => {
    expect(INDUSTRY_PROFILES.roofing.dashboard).toBeUndefined()
    const none = resolveOrgProfile({})
    expect(none.dashboard.cards).toBeNull()
    const r = resolveDashboard({}, none.dashboard.cards)
    expect(r).toMatchObject({ mode: 'classic', custom: false })
    expect(r.cards.map((c) => c.key)).toEqual(['classic-quick-stats', 'classic-pay', 'classic-my-goals', 'classic-team-scoreboard', 'classic-progress', 'classic-account-overview'])
  })

  it.each(['lawn_landscape', 'exterior_cleaning'] as const)('%s starts with the owner-approved cards, in order', (id) => {
    expect(INDUSTRY_PROFILES[id].dashboard?.cards).toEqual([
      'billed-week', 'collected-week', 'unpaid-overdue', 'revenue-per-crew-hour',
      'active-plans', 'new-plans-month', 'cancellations-month', 'mrr',
      'visits-done-week', 'visits-skipped-week', 'visits-moved-week',
      'quotes-sent-week', 'quotes-won-week', 'win-rate', 'dollars-sold-week',
      'salespeople', 'crews',
    ])
  })

  it('every starting key is in the catalog', () => {
    for (const id of INDUSTRY_PROFILE_IDS) for (const k of INDUSTRY_PROFILES[id].dashboard?.cards ?? []) expect(DASHBOARD_CARD_KEYS).toContain(k)
  })

  it('a card dashboard draws only cards with a source (the four without one are skipped)', () => {
    const r = lawnList()
    expect(r.mode).toBe('cards')
    expect(r.cards.map((c) => c.key)).not.toContain('mrr')
    expect(r.cards).toHaveLength(13)
  })
})

describe('lawn default shows no door-knocking wording', () => {
  const WORDS = /\b(doors?|inspections?|sits?|closers?|contacts?|setters?|canvass\w*|knock\w*)\b/i

  it('no card on the lawn starting list (label, description) uses it', () => {
    for (const { key } of lawnList().cards) {
      const c = DASHBOARD_CARDS.find((x) => x.key === key)!
      expect([key, WORDS.test(`${c.label} ${c.description}`)]).toEqual([key, false])
    }
  })

  it('the rendered owner dashboard uses none of it either', () => {
    const cards: CardData[] = lawnList().cards.map((c) => {
      const card = DASHBOARD_CARDS.find((x) => x.key === c.key)!
      return card.display === 'leaderboard'
        ? { kind: 'leaderboard', key: card.key, label: card.label, columns: [{ key: 'a', label: 'Visits done', format: 'count' }], rows: [{ id: '1', name: 'Crew A', values: [3] }], empty: '', failed: false }
        : { kind: 'tile', key: card.key, label: card.label, display: card.display as 'count', value: 4, goal: card.goal ? 10 : null }
    })
    const html = renderToStaticMarkup(<CardDashboard firstName="Pat" cards={cards} canEdit />)
    const text = html.replace(/<[^>]+>/g, ' ')
    expect(text).toContain('Billed this week')
    expect(WORDS.test(text)).toBe(false)
  })
})

describe('who sees which card', () => {
  const list = lawnList().cards
  const keys = (v: ReturnType<typeof viewer>) => cardsForViewer(list, v, lawn.features).map((c) => c.card.key)

  it('owners see every drawable card', () => {
    expect(keys(viewer(['owner'], true))).toHaveLength(13)
  })

  it('money cards are hidden without reports:financials — even from an owner', () => {
    const out = keys(viewer(['owner'], false))
    for (const k of ['billed-week', 'collected-week', 'unpaid-overdue']) expect(out).not.toContain(k)
    expect(out).toContain('quotes-won-week')
  })

  it('a salesperson sees sales cards only (the dollars card is their own, decided by the report runner)', () => {
    expect(keys(viewer(['sales'], false))).toEqual(['quotes-won-week', 'win-rate', 'dollars-sold-week', 'salespeople'])
  })

  it('a crew lead sees work cards and never a money card', () => {
    const out = cardsForViewer(list, viewer(['crew'], false), lawn.features).map((c) => c.card)
    expect(out.map((c) => c.key)).toEqual(['visits-done-week', 'visits-skipped-week', 'visits-moved-week', 'crews'])
    expect(out.every((c) => c.money === null)).toBe(true)
  })

  it('a person granted reports:financials sees the finance cards whatever their audience; field roles (no audience) see nothing', () => {
    expect(keys(viewer(['crew'], true))).toEqual(expect.arrayContaining(['billed-week', 'collected-week', 'unpaid-overdue']))
    expect(keys(viewer([], false))).toEqual([])
    expect(keys(viewer([], true)).filter((k) => !['billed-week', 'collected-week', 'unpaid-overdue'].includes(k))).toEqual([])
  })

  it('cards of a feature the company has off are not drawn', () => {
    const noPlans = { ...DEFAULT_ORG_FEATURES, servicePlans: false }
    const out = cardsForViewer(list, viewer(['owner'], true), noPlans).map((c) => c.card.key)
    expect(out).not.toContain('visits-done-week')
    expect(out).not.toContain('crews')
    expect(out).toContain('billed-week')
  })
})

describe('owner customization: server-side validation', () => {
  const ok = (cards: unknown) => parseCardsInput({ cards }, lawn.features)

  it('accepts catalog keys, in the owner’s order, with goals only where a card takes one', () => {
    const r = ok([{ key: 'quotes-won-week', goal: 5 }, { key: 'billed-week', goal: 12000 }, { key: 'win-rate' }])
    expect(r).toEqual({ ok: true, cards: [{ key: 'quotes-won-week', goal: 5 }, { key: 'billed-week', goal: 12000 }, { key: 'win-rate', goal: null }] })
  })

  it.each([
    ['an unknown key', [{ key: 'doors-knocked' }]],
    ['a key that only looks like a key', [{ key: '__proto__' }]],
    ['a card with no data source', [{ key: 'mrr' }]],
    ['the same card twice', [{ key: 'win-rate' }, { key: 'win-rate' }]],
    ['a goal on a card that takes none', [{ key: 'win-rate', goal: 5 }]],
    ['a goal of zero or less', [{ key: 'billed-week', goal: 0 }]],
    ['a goal that is not a number', [{ key: 'billed-week', goal: 'lots' }]],
    ['an empty list', []],
    ['classic sections mixed with cards', [{ key: 'classic-progress' }, { key: 'billed-week' }]],
    ['not a list', 'billed-week'],
  ])('refuses %s', (_why, cards) => {
    expect(ok(cards).ok).toBe(false)
  })

  it('refuses a card whose feature the company has turned off', () => {
    expect(parseCardsInput({ cards: [{ key: 'visits-done-week' }] }, { ...DEFAULT_ORG_FEATURES, servicePlans: false }).ok).toBe(false)
  })

  it('reading what is stored drops anything not in the catalog (a hand-edited row cannot draw a card)', () => {
    expect(readSavedCards({ dashboardCards: { cards: [{ key: 'nope' }, { key: 'mrr' }, { key: 'win-rate' }, { key: 'win-rate' }] } })).toEqual([{ key: 'win-rate', goal: null }])
    expect(readSavedCards({ dashboardCards: { cards: [{ key: 'nope' }] } })).toBeNull()
  })

  it('a saved list wins over the profile; the saved kind decides classic or cards, never a mix', () => {
    expect(resolveDashboard({ dashboardCards: { cards: [{ key: 'win-rate' }] } }, null)).toMatchObject({ mode: 'cards', custom: true })
    expect(resolveDashboard({ dashboardCards: { cards: [{ key: 'classic-progress' }, { key: 'win-rate' }] } }, lawn.dashboard.cards)).toMatchObject({ mode: 'classic', cards: [{ key: 'classic-progress', goal: null }] })
    // "Reset" = no stored cards: the profile's list again.
    expect(resolveDashboard({ dashboardCards: {} }, lawn.dashboard.cards)).toMatchObject({ mode: 'cards', custom: false })
  })

  it('the cards offered are only those whose features are on, and classic sections only for a classic dashboard', () => {
    const offeredCards = cardsOfferedTo({ ...DEFAULT_ORG_FEATURES, servicePlans: false }, 'cards').map((c) => c.key)
    expect(offeredCards).toEqual(expect.arrayContaining(['billed-week', 'win-rate']))
    expect(offeredCards).not.toContain('crews')
    expect(offeredCards).not.toContain('classic-progress')
    expect(cardsOfferedTo(DEFAULT_ORG_FEATURES, 'classic').every((c) => c.key.startsWith('classic-'))).toBe(true)
  })

  it('the settings key can only be written through its own writer (path ["dashboardCards"])', async () => {
    const client = { rpc: jest.fn() } as never
    expect((await mergeOrgSettings(client, 'o1', { dashboardCards: { cards: [] } })).error).toMatch(/saveDashboardCards/)
    expect((await mergeOrgSettings(client, 'o1', {}, { remove: ['dashboardCards'] })).error).toMatch(/saveDashboardCards/)
    expect((client as unknown as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled()
  })
})
