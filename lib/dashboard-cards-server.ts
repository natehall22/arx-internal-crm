/**
 * Server side of the dashboard cards (lib/dashboard-cards.ts has the catalog and the rules):
 *   - who is looking (`resolveDashboardViewer`): owners see every card, a salesperson sees sales cards and their own row,
 *     a crew lead their crew's work with no money, field roles nothing (CLAUDE.md "Field roles never see production or money");
 *   - the owner's list (`saveDashboardCards`, the ONE writer: validation, then mergeOrgSettings path ['dashboardCards']);
 *   - the numbers (`loadDashboardCardData`): every card calls an EXISTING source — the report runner, or the loader a Today
 *     queue / screen already uses — and a failed read is a dash, never a false 0.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fromZonedTime } from 'date-fns-tz'

import {
  DASHBOARD_CARDS_SETTINGS_KEY,
  isClassicCard,
  dashboardCardByKey,
  parseCardsInput,
  type DashboardMode,
  type CardData,
  type DashboardAudience,
  type DashboardCard,
  type CardSource,
  type DashboardViewer,
  type LeaderboardData,
  type SavedCard,
  type TileData,
} from '@/lib/dashboard-cards'
import { loadOrgTimeZone } from '@/lib/cron-orgs'
import { resolveEffectivePermissionNames, resolveIsFieldRole } from '@/lib/effective-permissions'
import { hasFinancials } from '@/lib/financials-access'
import { resolveOpsAccess } from '@/lib/ops-access'
import type { OrgFeatures } from '@/lib/org-features'
import { mergeOrgSettings } from '@/lib/org-settings'
import { isOrgSuperuserRoleSlug } from '@/lib/org-role-constants'
import type { ReportSpec } from '@/lib/reporting/report-spec'
import { ReportAccessError, buildReportContext, runReport, type ReportContext, type ReportResult } from '@/lib/reporting/run'
import { SKIP_REASON_LABELS, addDaysYmd, ymdInZone } from '@/lib/service-plans'
import { loadServicePlans, loadVisits, type VisitView } from '@/lib/service-plans-db'
import { loadUnpaidInvoices } from '@/lib/service-billing-db'
import { isSuperAdmin } from '@/lib/super-admin'
import { loadCrewIdsLedBy, loadWorkSecondsByStop } from '@/lib/time-tracking-db'
import { orgDb } from '@/lib/supabase/org-db'
import { todayKindFor } from '@/lib/today'

type Profile = { id: string; org_id: string; role: string; custom_role_id?: string | null; team_id?: string | null; region_id?: string | null; is_super_admin?: boolean | null; active?: boolean | null }

export type DashboardViewerInfo = DashboardViewer & {
  userId: string
  /** The crews this person leads (null = not narrowed to crews: owners and office staff see every crew). */
  ledSubIds: string[] | null
}

const SALES_ROLES = ['sales_rep', 'closer', 'sales_manager', 'regional_manager']

/** Who is looking at the dashboard. Field roles get no audience (and never money), whatever they were granted. */
export async function resolveDashboardViewer(admin: SupabaseClient, profile: Profile): Promise<DashboardViewerInfo> {
  const none: DashboardViewerInfo = { userId: profile.id, audiences: new Set<DashboardAudience>(), financials: false, ledSubIds: null }
  if (await resolveIsFieldRole(admin, profile)) return none
  const perms = await resolveEffectivePermissionNames(admin, profile.id, profile)
  const financials = hasFinancials(perms)
  if (isOrgSuperuserRoleSlug(profile.role) || isSuperAdmin(profile)) return { userId: profile.id, audiences: new Set<DashboardAudience>(['owner']), financials, ledSubIds: null }
  const canJobBoard = (await resolveOpsAccess(admin, profile.id, profile)).canJobBoard
  const kind = todayKindFor({ role: profile.role, isSuperuser: false, canJobBoard })
  // Crews this person leads, tracked or not. A failed lookup is "no crew access" (fail closed): the crew view is never the fallback.
  let led: string[] | null = null
  try { led = await loadCrewIdsLedBy(admin, profile.org_id, profile.id) } catch (e) { console.error('dashboard: crew lookup failed', e) }
  const audiences = new Set<DashboardAudience>()
  if (SALES_ROLES.includes(profile.role) && kind !== 'ops') audiences.add('sales')
  if (led !== null) {
    if (kind === 'ops') audiences.add('crew')
    else if (!SALES_ROLES.includes(profile.role) && led.length === 0) audiences.add('sales') // an unknown role keeps what it had: the closer view
    if (led.length > 0) audiences.add('crew')
  }
  const ledSubIds = led !== null && audiences.has('crew') && led.length > 0 ? led : null
  // A lookup that failed leaves a crew-only viewer with ledSubIds null AND no 'crew' audience: no crew card, no crew data.
  return { userId: profile.id, audiences, financials, ledSubIds }
}

/** Who is saving, and where the company's dashboard stands now (the route reads both; the writer enforces the rules). */
export type SaveContext = {
  /** `isSuperAdmin(profile)`: the owner. */
  owner: boolean
  /** The company's industry profile id: a roofing company is never switched to cards. */
  profileId: string
  /** What the company's dashboard is now (`resolveDashboard(...).mode`). */
  currentMode: DashboardMode
  /** What a reset returns to: cards when the profile has a starting list, else classic. */
  startMode: DashboardMode
}

/**
 * The ONE writer of the card list. Validated against the catalog and the company's features; `reset` returns to the profile's
 * starting list. Rules enforced HERE, not only in the screen: saving a classic sections list (which can hide "Estimated pay" and
 * the like) and switching between the classic dashboard and cards are the OWNER's alone, and a roofing company cannot be switched
 * to cards at all. An admin may still edit an existing card dashboard.
 */
export async function saveDashboardCards(
  admin: SupabaseClient,
  orgId: string,
  input: unknown,
  features: OrgFeatures | null,
  ctx: SaveContext,
  opts: { reset?: boolean } = {}
): Promise<{ ok: true; cards: SavedCard[] | null } | { ok: false; error: string; status: 400 | 403 | 500 }> {
  if (opts.reset) {
    if (!ctx.owner && ctx.currentMode !== ctx.startMode) return { ok: false, error: 'Only the owner can switch the dashboard type', status: 403 }
    const { error } = await mergeOrgSettings(admin, orgId, {}, { path: [DASHBOARD_CARDS_SETTINGS_KEY], remove: ['cards'] })
    return error ? { ok: false, error: 'Could not save', status: 500 } : { ok: true, cards: null }
  }
  const parsed = parseCardsInput(input, features)
  if (!parsed.ok) return { ok: false, error: parsed.error, status: 400 }
  const target: DashboardMode = isClassicCard(dashboardCardByKey(parsed.cards[0].key)!) ? 'classic' : 'cards'
  if (target === 'classic' && !ctx.owner) return { ok: false, error: 'Only the owner can change which sections the dashboard shows', status: 403 }
  if (target !== ctx.currentMode) {
    if (!ctx.owner) return { ok: false, error: 'Only the owner can switch the dashboard type', status: 403 }
    if (target === 'cards' && ctx.profileId === 'roofing') return { ok: false, error: 'This company keeps the classic dashboard', status: 403 }
  }
  const { error } = await mergeOrgSettings(admin, orgId, { cards: parsed.cards }, { path: [DASHBOARD_CARDS_SETTINGS_KEY] })
  return error ? { ok: false, error: 'Could not save', status: 500 } : { ok: true, cards: parsed.cards }
}

/* ------------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------------ */

const TOP_REASONS = 3

type Window = {
  /** First and last DAY of the week (Sunday..Saturday) and today, in the company's zone. */
  from: string; today: string; weekEnd: string; monthStart: string; timeZone: string
  /** The same week as exact instants: the company's Sunday 00:00 through the last millisecond of its Saturday. */
  fromIso: string; toIso: string
}

/** Midnight at the start of a calendar day in a zone, as an instant (the time zone database: right on both clock-change days). */
const dayStartIso = (ymd: string, timeZone: string): string => fromZonedTime(`${ymd}T00:00:00`, timeZone).toISOString()

export function dashboardWindow(now: Date, timeZone: string): Window {
  // The week starts on Sunday, like the classic dashboard's "week" (lib/date-ranges.ts), counted from the company's own today.
  const today = ymdInZone(now, timeZone)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const from = addDaysYmd(today, -weekday)
  const fromIso = dayStartIso(from, timeZone)
  const toIso = new Date(Date.parse(dayStartIso(addDaysYmd(from, 7), timeZone)) - 1).toISOString()
  return { from, today, weekEnd: addDaysYmd(from, 6), monthStart: `${today.slice(0, 7)}-01`, timeZone, fromIso, toIso }
}

/** The report runner for one viewer: a salesperson (not an owner) only ever reads their own deals — narrowing, never widening. */
function narrowCtx(ctx: ReportContext, viewer: DashboardViewerInfo): ReportContext {
  return viewer.audiences.has('owner') ? ctx : { ...ctx, scope: 'own', scopedUserIds: [viewer.userId] }
}

const tile = (card: DashboardCard, goal: number | null, value: number | null, sub?: string): TileData => ({
  kind: 'tile', key: card.key, label: card.label, display: card.display as TileData['display'], value, goal, ...(sub ? { sub } : {}),
})

export async function loadDashboardCardData(
  admin: SupabaseClient,
  args: { profile: Profile; viewer: DashboardViewerInfo; cards: Array<{ card: DashboardCard; goal: number | null }>; features: OrgFeatures | null; now?: Date }
): Promise<CardData[]> {
  const { profile, viewer, features } = args
  const orgId = profile.org_id
  const now = args.now ?? new Date()
  const win = dashboardWindow(now, await loadOrgTimeZone(admin, orgId))

  const once = <T,>(fn: () => Promise<T>) => { let p: Promise<T> | null = null; return () => (p ??= fn()) }
  const reportCtx = once(async () => narrowCtx(await buildReportContext(admin, profile), viewer))
  // Visits this week, narrowed to the crews a crew lead leads (office staff and owners see every crew).
  const visits = once(async (): Promise<VisitView[]> => {
    const all = (await loadVisits(admin, orgId, { from: win.from, to: win.weekEnd, accessNotes: false })).filter((v) => v.status !== 'cancelled')
    return viewer.ledSubIds && !viewer.audiences.has('owner') ? all.filter((v) => !!v.subId && viewer.ledSubIds!.includes(v.subId)) : all
  })
  // One scan per (dataset, week, grouping, filters) for cards that sum different columns of it (billed + collected share rpt_revenue):
  // the first card's run also sums its siblings' columns (the runner's `alsoSum`).
  const runKey = (spec: ReportSpec, range: string) => JSON.stringify([spec.dataset, range, spec.groupBy ?? null, spec.filters, spec.metric.kind])
  const siblingSums = new Map<string, string[]>()
  for (const { card } of args.cards) {
    const src = card.source
    if (src.kind !== 'report' || src.spec.metric.kind !== 'sum') continue
    const k = runKey(src.spec, src.range)
    const cols = siblingSums.get(k) ?? []
    if (!cols.includes(src.spec.metric.column)) cols.push(src.spec.metric.column)
    siblingSums.set(k, cols)
  }
  const reportRuns = new Map<string, Promise<ReportResult>>()
  const runCard = (ctx: ReportContext, src: Extract<CardSource, { kind: 'report' }>): Promise<ReportResult> => {
    const k = runKey(src.spec, src.range)
    const cols = siblingSums.get(k)
    // Only a plain summed card shares; every other spec runs as written.
    const spec: ReportSpec = cols && src.spec.metric.kind === 'sum' && cols.length > 1 ? { ...src.spec, metric: { kind: 'sum', column: cols[0] }, alsoSum: cols.slice(1) } : src.spec
    const key = cols && cols.length > 1 ? k : `${k}|${JSON.stringify(src.spec.metric)}`
    let p = reportRuns.get(key)
    if (!p) { p = runReport(admin, ctx, spec, src.range === 'week' ? { bounds: { start: win.fromIso, end: win.toIso } } : {}); reportRuns.set(key, p) }
    return p
  }
  const userNames = async (ids: string[]) => {
    const out = new Map<string, string>()
    if (ids.length === 0) return out
    const { data } = await orgDb(admin, orgId).from('users').select('id, full_name').in('id', ids)
    for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) out.set(u.id, u.full_name || 'Unnamed')
    return out
  }
  const plans = once(() => loadServicePlans(admin, orgId))
  const unpaid = once(() => loadUnpaidInvoices(admin, orgId))

  async function one({ card, goal }: { card: DashboardCard; goal: number | null }): Promise<CardData | null> {
    const src = card.source
    try {
      if (src.kind === 'report') {
        const ctx = await reportCtx()
        const r = await runCard(ctx, src)
        if (src.read === 'groups') {
          // One row per salesperson, grouped by user id (two people with the same name stay two rows); the name is only the label.
          const ids = r.rows.map((row) => String(row.group)).filter((id) => id !== '(none)')
          const names = await userNames(ids)
          const lb: LeaderboardData = {
            kind: 'leaderboard', key: card.key, label: card.label, failed: false, empty: 'Nothing this week yet.',
            columns: [{ key: 'wins', label: 'Quotes won', format: 'count' }, { key: 'dollars', label: 'Dollars sold', format: 'money' }],
            rows: r.rows.map((row) => {
              const id = String(row.group)
              return { id, name: id === '(none)' ? 'No closer' : names.get(id) ?? 'Unnamed', values: [Number(row.rows) || 0, Number(row.value) || 0] }
            }),
          }
          return lb
        }
        if (src.spec.metric.kind === 'sum') {
          const cols = siblingSums.get(runKey(src.spec, src.range))
          if (cols && cols.length > 1 && src.spec.metric.column !== cols[0]) {
            return tile(card, goal, r.rows.reduce((t, row) => t + (Number(row[`sum_${(src.spec.metric as { column: string }).column}`]) || 0), 0))
          }
        }
        const rate = src.spec.metric.kind === 'rate'
        const value = rate ? (r.scanned > 0 ? Number(r.rows[0]?.value ?? 0) : null) : r.summary?.value ?? 0
        return tile(card, goal, value)
      }
      if (src.kind !== 'loader') return null

      if (src.loader === 'unpaidInvoices') {
        const loaded = await unpaid()
        if (!loaded) return tile(card, goal, null)
        const owed = loaded.rows.reduce((s, r) => s + r.balanceCents, 0) / 100
        const overdue = loaded.rows.filter((r) => r.dueAt && r.dueAt.slice(0, 10) < win.today).length
        return tile(card, goal, owed, `${loaded.rows.length} unpaid · ${overdue} overdue${loaded.capped ? ' (oldest checked)' : ''}`)
      }
      if (src.loader === 'servicePlans') {
        const { ready, plans: all } = await plans()
        if (!ready) return tile(card, goal, null)
        const value = src.measure === 'active'
          ? all.filter((p) => p.status === 'active').length
          : all.filter((p) => p.created_at && ymdInZone(new Date(p.created_at), win.timeZone) >= win.monthStart).length
        return tile(card, goal, value)
      }
      if (src.loader === 'visits') {
        const v = await visits()
        if (src.measure === 'done') return tile(card, goal, v.filter((x) => x.status === 'completed').length, `of ${v.length} scheduled this week`)
        if (src.measure === 'moved') return tile(card, goal, v.filter((x) => x.moved).length)
        if (src.measure === 'skipped') {
          const skipped = v.filter((x) => x.status === 'skipped')
          const by = new Map<string, number>()
          for (const x of skipped) {
            const why = x.skipReason ? SKIP_REASON_LABELS[x.skipReason as keyof typeof SKIP_REASON_LABELS] ?? x.skipReason : 'No reason given'
            by.set(why, (by.get(why) ?? 0) + 1)
          }
          const top = Array.from(by.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_REASONS).map(([why, n]) => `${why} ${n}`).join(' · ')
          return tile(card, goal, skipped.length, top || undefined)
        }
        if (src.measure === 'crews') {
          const hoursOn = features?.timeTracking === true
          const crews = new Map<string, { name: string; done: number; skipped: number; seconds: number }>()
          const crewOf = new Map<string, string>()
          for (const x of v) {
            const key = x.subId ?? 'none'
            const c = crews.get(key) ?? { name: x.subName ?? 'No crew assigned', done: 0, skipped: 0, seconds: 0 }
            if (x.status === 'completed') c.done += 1
            if (x.status === 'skipped') c.skipped += 1
            crews.set(key, c)
            crewOf.set(x.id, key)
          }
          let hoursFailed = false
          if (hoursOn) {
            // The same week as the visits above (the company's Sunday through Saturday), read without closing anyone's clock.
            const seconds = await loadWorkSecondsByStop(admin, orgId, { fromIso: win.fromIso, toIso: win.toIso, workOrderIds: Array.from(crewOf.keys()) }).catch(() => null)
            if (!seconds) hoursFailed = true
            else for (const [stopId, secs] of Array.from(seconds.entries())) {
              const c = crews.get(crewOf.get(stopId) ?? '')
              if (c) c.seconds += secs
            }
          }
          const columns: LeaderboardData['columns'] = [{ key: 'done', label: 'Visits done', format: 'count' }, ...(hoursOn ? [{ key: 'hours', label: 'Hours', format: 'hours' as const }] : []), { key: 'skips', label: 'Skips', format: 'count' }]
          const rows = Array.from(crews.entries())
            .sort((a, b) => b[1].done - a[1].done || a[1].name.localeCompare(b[1].name))
            .map(([id, c]) => ({ id, name: c.name, values: [c.done, ...(hoursOn ? [hoursFailed ? null : Math.round((c.seconds / 3600) * 10) / 10] : []), c.skipped] }))
          return { kind: 'leaderboard', key: card.key, label: card.label, columns, rows, empty: 'No visits scheduled this week.', failed: false }
        }
      }
      return null
    } catch (e) {
      // Not allowed for this viewer (money fence in the runner): the card is simply not theirs. Anything else: said as a dash.
      if (e instanceof ReportAccessError) return null
      console.error('dashboard card failed', card.key, e)
      return card.display === 'leaderboard'
        ? { kind: 'leaderboard', key: card.key, label: card.label, columns: [], rows: [], empty: '', failed: true }
        : tile(card, goal, null)
    }
  }

  const out = await Promise.all(args.cards.map(one))
  return out.filter((c): c is CardData => c !== null)
}
