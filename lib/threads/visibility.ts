/**
 * Who can read and write which job-thread message. Pure and client-safe.
 *
 * Mirrors the SQL function `message_visible_to` (migration 202610270010), which backs
 * browser-client reads (RLS) and search. The app reads through the service client, so
 * THIS file is the rule the server actually applies — `lib/threads/get-thread.ts` and
 * `post-message.ts` are the only readers/writers and both go through it.
 *
 * Audiences: team (everyone on the deal), sales (selling talk; ops reads it), production
 * (how to build it — never setters/inside sales), crew (leaves the building on the crew
 * link; only ops/owners write it). `restricted_pricing` hides a message from anyone
 * barred from sales docs (setters, canvassers, inside sales), whatever its audience.
 * `audience = null` is a legacy row: unchanged behaviour (anyone in the org).
 */

export const AUDIENCES = ['team', 'sales', 'production', 'crew'] as const
export type Audience = (typeof AUDIENCES)[number]

export type Priority = 'fyi' | 'needs_reply' | 'urgent'

export type ThreadViewer = {
  userId: string
  orgId: string
  /** admin/owner role or super admin: reads and writes everything. */
  ownerLike: boolean
  /** Can open the job board (can_view_job_board / jobs:view). */
  jobBoard: boolean
  /** jobs:edit — ops who may write Production + Crew. */
  jobEdit: boolean
  /** jobs:financials:view — may open the Money tab. */
  jobFinancials: boolean
  /** manager / sales manager / regional manager / operations role. */
  managerLike: boolean
  /** rep / sales_rep / closer. */
  closerLike: boolean
  /** setter, canvasser, inside sales, call center: own deals only, no production, no pricing. */
  setterLike: boolean
  /** isBarredFromSalesDocAccess — no pricing-flagged messages. */
  pricingBarred: boolean
  /** Inside-sales / call-center worker: works the whole queue, never production or pricing. */
  insideSales?: boolean
}

/** A role the thread rules positively know. Anyone else (sub, custom-only roles) reads nothing: fail closed. */
export function isRecognizedViewer(v: ThreadViewer): boolean {
  return v.ownerLike || v.jobBoard || v.managerLike || v.closerLike || v.setterLike || v.insideSales === true
}

export type DealRef = {
  owner_user_id: string | null
  setter_user_id: string | null
  /** Appointment closer(s) on the deal: the person who runs the inspection may differ from opportunities.owner_user_id. */
  closer_user_ids?: string[]
  /** Appointment canvasser(s) / other people who set the deal. */
  extra_user_ids?: string[]
} | null

export type MessageGate = {
  audience: Audience | null
  restricted_pricing?: boolean | null
}

export function ownsDeal(v: ThreadViewer, deal: DealRef): boolean {
  return (
    !!deal &&
    (deal.owner_user_id === v.userId ||
      deal.setter_user_id === v.userId ||
      (deal.closer_user_ids ?? []).includes(v.userId) ||
      (deal.extra_user_ids ?? []).includes(v.userId))
  )
}

function ownsDealAsCloser(v: ThreadViewer, deal: DealRef): boolean {
  return v.closerLike && !!deal && (deal.owner_user_id === v.userId || (deal.closer_user_ids ?? []).includes(v.userId))
}

/**
 * Field roles — setters, canvassers, inside sales / call center — NEVER see Production/Crew, the Job tab, pricing or financials,
 * whatever job-board permission a custom role or a per-user grant gave them. This deny is checked BEFORE every positive grant
 * (the resolver also strips every jobs: and ops: permission from theirs; this is the second lock, and the SQL `message_visible_to`
 * mirrors it).
 */
export function isFieldRole(v: ThreadViewer): boolean {
  return !v.ownerLike && (v.setterLike || v.insideSales === true || v.pricingBarred)
}

/** True when the viewer may see the Production/Crew sides of this deal. */
export function canSeeProduction(v: ThreadViewer, deal: DealRef): boolean {
  if (isFieldRole(v)) return false
  if (v.ownerLike) return true
  return v.jobBoard || v.managerLike || ownsDealAsCloser(v, deal)
}

export function canReadMessage(v: ThreadViewer, deal: DealRef, m: MessageGate): boolean {
  if (m.audience === null) return true // legacy
  if (v.ownerLike) return true
  if (!isRecognizedViewer(v)) return false
  if (m.restricted_pricing && v.pricingBarred) return false
  if (m.audience === 'production' || m.audience === 'crew') return canSeeProduction(v, deal)
  // team | sales
  // Setters/canvassers and closers read team/sales talk on their own deals only.
  if (v.setterLike || v.closerLike) return deal === null ? true : ownsDeal(v, deal)
  return true
}

/** A row on a known deal is checked against that deal; a row with no deal ('none') is only for people not scoped to their own deals. */
export function canReadRowOnDeal(v: ThreadViewer, ref: DealRef | 'none', m: MessageGate): boolean {
  if (ref === 'none') return !(v.setterLike || v.closerLike) && canReadMessage(v, null, m)
  return canReadMessage(v, ref, m)
}

/** Audiences the viewer may WRITE on this deal, in composer order. Crew is never a default. */
export function writableAudiences(v: ThreadViewer, deal: DealRef): Audience[] {
  const out: Audience[] = []
  if (!v.ownerLike && !isRecognizedViewer(v)) return out
  if ((v.setterLike || v.closerLike) && deal && !ownsDeal(v, deal)) return out
  out.push('team')
  out.push('sales')
  if (canSeeProduction(v, deal) && (v.ownerLike || v.jobEdit || v.jobBoard || ownsDealAsCloser(v, deal))) out.push('production')
  if (!isFieldRole(v) && (v.ownerLike || v.jobEdit)) out.push('crew')
  return out
}

export type Surface = 'sales' | 'job' | 'overview' | 'other'

/** First match wins (notes-messaging spec §7.2). Crew is never chosen automatically. */
export function defaultAudience(
  v: ThreadViewer,
  input: { surface: Surface; replyTo?: { audience: Audience | null } | null; dealSold?: boolean; lastUsed?: Audience | null },
  deal: DealRef
): Audience {
  const allowed = writableAudiences(v, deal)
  const pick = (a: Audience): Audience => (allowed.includes(a) ? a : 'team')
  if (input.replyTo?.audience && allowed.includes(input.replyTo.audience)) return input.replyTo.audience
  if (v.setterLike) return 'team'
  if (input.surface === 'job') return pick('production')
  if (input.surface === 'sales') return v.closerLike && !input.dealSold ? pick('sales') : 'team'
  if (input.lastUsed && allowed.includes(input.lastUsed) && input.lastUsed !== 'crew') return input.lastUsed
  if (v.ownerLike || v.jobEdit) return 'team'
  return 'team'
}

const PRICING_PATTERNS: RegExp[] = [
  /\$\s?\d[\d,]*(\.\d+)?/,
  /\b\d[\d,]*(\.\d+)?\s?(k|grand|bucks)\b/i,
  /\b(price|pricing|priced|quotes?|quoted|bid)\b/i,
  /\b(discount|discounted)\b|\d+\s?%\s?off|off the (price|total)\b/i,
  /\b(commission|override|payout|margin|profit)\b/i,
  /\b(financ(e|ing|ed)|dealer fee|deposit)\b/i,
  /\bper square\b|\bsq\s?@/i,
]

/** Client + server check; the composer shows "Looks like pricing" and sets the flag by default. */
export function looksLikePricing(text: string): boolean {
  return PRICING_PATTERNS.some((re) => re.test(text))
}

/** Edit own any time; delete own within 15 min; owners hide anything (audited, never hard-deleted). */
export const DELETE_WINDOW_MS = 15 * 60 * 1000
export function canDeleteMessage(
  v: ThreadViewer,
  m: { user_id: string | null; created_at: string },
  now = Date.now()
): boolean {
  if (v.ownerLike) return true
  return m.user_id === v.userId && now - new Date(m.created_at).getTime() <= DELETE_WINDOW_MS
}

export function canPin(v: ThreadViewer, m: { user_id: string | null }): boolean {
  return v.ownerLike || v.jobEdit || v.managerLike || (v.closerLike && m.user_id === v.userId)
}

/** Re-classify someone else's message: owners any; ops to Production/Team (Crew needs jobEdit); sales managers Sales<->Team. */
export function canReclassify(v: ThreadViewer, to: Audience): boolean {
  if (v.ownerLike) return true
  if (to === 'crew' || to === 'production') return v.jobEdit
  if (to === 'team') return v.jobEdit || v.managerLike
  return v.managerLike
}

/** People who could read a message — the @mention picker and notification fan-out only offer these. */
export function viewerCanBeMentioned(candidate: ThreadViewer, deal: DealRef, m: MessageGate): boolean {
  return canReadMessage(candidate, deal, m)
}
