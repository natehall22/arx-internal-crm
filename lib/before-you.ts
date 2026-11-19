/**
 * "Before you" — what the crews ahead of this one have done on the same property: "Grading — done Nov 12", "Sod — not done yet".
 * A crew lead sees only what affects them: the trade's name, done / not done and a date. No customer, no contact, no money.
 *
 * Which crews are "ahead": the other trades on the same property (work_orders.property_id) that come EARLIER in the company's own
 * trade order (org_trades.sort — Settings → Job setup), plus any stage a job's schedule says this one depends on
 * (job_stages.depends_on, when that stage is tied to a crew). Only for companies using property tools; others see nothing new.
 * Pure and client-safe; the database read is lib/before-you-db.ts.
 */
import { orderedTrades, tradeLabel, type OrgTrade } from '@/lib/org-trades'

export type BeforeYouLine = { trade: string; label: string; done: boolean; /** Day done, else day booked; null = not booked. YYYY-MM-DD */ date: string | null }

export type CrewRow = { id: string; job_id: string | null; property_id: string | null; trade: string | null; status: string; scheduled_date: string | null; completed_at: string | null }

/** "2026-11-12" → "Nov 12" (a calendar day, no time zone involved). */
export function shortYmd(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? ''} ${d}`
}

/** "Grading — done Nov 12" / "Sod — not done yet" / "Sod — not done yet · Nov 20". */
export function beforeYouText(l: BeforeYouLine): string {
  if (l.done) return `${l.label} — done${l.date ? ` ${shortYmd(l.date)}` : ''}`
  return `${l.label} — not done yet${l.date ? ` · ${shortYmd(l.date)}` : ''}`
}

/**
 * Pure. `me` = the crew row; `siblings` = every non-cancelled crew row on the same property (any job); `predecessorIds` = crew rows
 * its job schedule says come first. One line per trade, in the company's order.
 */
export function beforeYouFor(
  me: Pick<CrewRow, 'id' | 'trade' | 'property_id'>,
  siblings: readonly CrewRow[],
  predecessorIds: ReadonlySet<string>,
  orgTrades: readonly OrgTrade[],
  doneDay: (completedAt: string) => string
): BeforeYouLine[] {
  if (!me.trade || !me.property_id) return []
  const rank = new Map(orderedTrades(orgTrades).map((t, i) => [t.slug, i]))
  const r = (slug: string) => rank.get(slug) ?? Number.MAX_SAFE_INTEGER
  const mine = r(me.trade)
  const ahead = siblings.filter((s) => s.id !== me.id && s.trade && s.trade !== me.trade && s.property_id === me.property_id && s.status !== 'cancelled' && (r(s.trade) < mine || predecessorIds.has(s.id)))
  const byTrade = new Map<string, CrewRow[]>()
  for (const s of ahead) byTrade.set(s.trade as string, [...(byTrade.get(s.trade as string) ?? []), s])
  const lines: BeforeYouLine[] = []
  for (const [trade, rows] of Array.from(byTrade)) {
    const open = rows.filter((x) => x.status !== 'completed')
    if (open.length === 0) {
      const days = rows.map((x) => (x.completed_at ? doneDay(x.completed_at) : null)).filter((d): d is string => !!d).sort()
      lines.push({ trade, label: tradeLabel(trade, orgTrades), done: true, date: days.length ? days[days.length - 1] : null })
    } else {
      const booked = open.map((x) => x.scheduled_date).filter((d): d is string => !!d).sort()
      lines.push({ trade, label: tradeLabel(trade, orgTrades), done: false, date: booked[0] ?? null })
    }
  }
  return lines.sort((a, b) => r(a.trade) - r(b.trade))
}
