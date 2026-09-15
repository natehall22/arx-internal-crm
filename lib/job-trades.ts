/**
 * Job trades — the crews that work a job.
 *
 * A job can need several crews on different (or the same) days: roofing,
 * gutters, siding, … Each is ONE `work_orders` row with `trade` set
 * (`work_order_type = 'install'`), carrying its own sub, date, length, Google
 * invite and crew photo link. See `supabase/migrations/202609150001_*`.
 *
 * `production_jobs.scheduled_date` / `install_days` / `assigned_sub_id` are
 * read by 40+ places (ops board, dashboards, payroll install date, sub RLS).
 * They are kept, but DERIVED: `syncJobScheduleFromTrades` (lib/job-trades-db.ts)
 * is the only writer, applying {@link deriveJobSchedule}. Never schedule a job
 * by writing those columns directly — that is a second answer to "who is on
 * this job, when" and it silently skips the invite.
 *
 * Trades appear two ways:
 *   - automatically (`ensureJobTrades`, lib/job-trades-db.ts): the primary trade (from
 *     `job_type`), plus any trade whose line items were sold on the proposal;
 *   - by hand, from the job page, for work sold outside the proposal.
 * Auto trades are only ever ADDED. Removing one sets it `cancelled` (kept, so
 * the unique index stops it being re-added on the next page load).
 *
 * This file is PURE and client-safe (labels, lengths, detection, derivation).
 * Database reads/writes live in `lib/job-trades-db.ts`.
 */

export const TRADES = ['roofing', 'gutters', 'siding', 'windows', 'other'] as const
export type Trade = (typeof TRADES)[number]

export const TRADE_LABELS: Record<Trade, string> = {
  roofing: 'Roofing',
  gutters: 'Gutters',
  siding: 'Siding',
  windows: 'Windows',
  other: 'Other',
}

export function isTrade(value: unknown): value is Trade {
  return typeof value === 'string' && (TRADES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------------ *
 * Crew time on site. Ops picks it by hand for now; the values are what a future
 * auto-estimate writes too. Stored as NUMERIC on work_orders.install_days.
 * ------------------------------------------------------------------------ */

export const INSTALL_DAY_OPTIONS = [0.5, 1, 1.5, 2] as const
export type InstallDays = (typeof INSTALL_DAY_OPTIONS)[number]

export function parseInstallDays(value: unknown): InstallDays | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return (INSTALL_DAY_OPTIONS as readonly number[]).includes(n) ? (n as InstallDays) : null
}

/** A NULL or unrecognised length is one day — the pre-trades default. */
export function installDaysOrDefault(value: unknown): InstallDays {
  return parseInstallDays(value) ?? 1
}

export function formatInstallDays(value: unknown): string {
  switch (installDaysOrDefault(value)) {
    case 0.5:
      return '½ day'
    case 1:
      return '1 day'
    case 1.5:
      return '1½ days'
    case 2:
      return '2 days'
  }
}

/** How many calendar dates the crew touches: ½ → 1, 1½ → 2. */
export function calendarDaySpan(value: unknown): 1 | 2 {
  return installDaysOrDefault(value) > 1 ? 2 : 1
}

/** A ½-day crew block, in hours. */
export const HALF_DAY_HOURS = 4
const DEFAULT_HALF_DAY_START = '08:00'

/** Latest ½-day start: the block must end by 11 PM (`24:00:00` is not a valid wall-clock time). */
const LATEST_HALF_DAY_START_MINUTES = 23 * 60 - HALF_DAY_HOURS * 60

/** `HH:mm[:ss]` → minutes after midnight for a ½-day start; bad/missing → 8:00 AM, clamped so the block ends the same day. */
export function halfDayStartMinutes(time: string | null | undefined): number {
  const match = /^(\d{2}):(\d{2})/.exec(time ?? '') ?? /^(\d{2}):(\d{2})/.exec(DEFAULT_HALF_DAY_START)!
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Math.min(minutes, LATEST_HALF_DAY_START_MINUTES)
}

export function formatWallClock12h(time: string | null | undefined): string {
  const minutes = halfDayStartMinutes(time)
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/* ------------------------------------------------------------------------ *
 * Detection from what was sold. Deliberately conservative: a missed trade is
 * one "+ Add trade" click; a wrong one books a crew nobody needs. Fascia/soffit
 * are NOT matched — on these jobs they are done by the roofer, the gutter crew
 * or the siding crew depending on the job, so ops decides.
 * ------------------------------------------------------------------------ */

const TRADE_LINE_ITEM_PATTERNS: [Exclude<Trade, 'roofing' | 'other'>, RegExp][] = [
  ['gutters', /gutter|downspout/i],
  ['siding', /siding/i],
  ['windows', /\bwindows?\b/i],
]

export function detectTradesFromLineItems(
  items: { name?: string | null; category?: string | null }[]
): Trade[] {
  const found = new Set<Trade>()
  for (const item of items) {
    const text = `${item.name ?? ''} ${item.category ?? ''}`
    for (const [trade, pattern] of TRADE_LINE_ITEM_PATTERNS) {
      if (pattern.test(text)) found.add(trade)
    }
  }
  return TRADES.filter((t) => found.has(t))
}

/** The trade a job always has, from its `job_type` ('mixed' and unknown → roofing). */
export function primaryTradeForJobType(jobType: string | null | undefined): Trade {
  const t = String(jobType ?? '').toLowerCase().trim()
  if (t === 'gutters' || t === 'gutter') return 'gutters'
  if (t === 'siding') return 'siding'
  if (t === 'windows' || t === 'window') return 'windows'
  return 'roofing'
}

/* ------------------------------------------------------------------------ *
 * Crew photo link
 * ------------------------------------------------------------------------ */

const DEFAULT_APP_URL = 'https://arx-internal-crm.vercel.app'

export function resolveAppUrl(appUrl?: string | null): string {
  return appUrl || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL
}

/**
 * 192 bits, URL-safe. Stored as-is: it only grants photo upload to one trade.
 * Web Crypto (not node:crypto) so this module stays importable from client
 * components for its labels and length helpers.
 */
export function newCrewLinkToken(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function crewLinkUrl(token: string, appUrl?: string | null): string {
  return `${resolveAppUrl(appUrl)}/crew/${token}`
}

/** A link keeps working this long after the crew's last scheduled day (return trips, late photos). */
export const CREW_LINK_GRACE_DAYS = 30

/* ------------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------------ */

export const JOB_TRADE_COLUMNS =
  'id, org_id, job_id, work_order_number, trade, trade_source, status, assigned_sub_id, scheduled_date, scheduled_time_start, install_days, install_google_event_id, install_calendar_id, install_sync_failed_at, install_sync_error, crew_link_token, completed_at, created_at'

export type JobTradeRow = {
  id: string
  org_id: string
  job_id: string
  work_order_number: string
  trade: Trade
  trade_source: 'auto' | 'manual' | null
  status: string
  assigned_sub_id: string | null
  scheduled_date: string | null
  scheduled_time_start: string | null
  install_days: number | string | null
  install_google_event_id: string | null
  install_calendar_id: string | null
  install_sync_failed_at: string | null
  install_sync_error: string | null
  crew_link_token: string | null
  completed_at: string | null
  created_at: string
}

export function isTradeActive(row: { status: string }): boolean {
  return row.status !== 'cancelled'
}

export function isTradeComplete(row: { status: string }): boolean {
  return row.status === 'completed'
}

/** Roofing first, then the fixed trade order, then creation time. */
export function sortTrades<T extends { trade: Trade; created_at: string }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => TRADES.indexOf(a.trade) - TRADES.indexOf(b.trade) || a.created_at.localeCompare(b.created_at)
  )
}

/* ------------------------------------------------------------------------ *
 * Job-level schedule derived from trades (pure)
 * ------------------------------------------------------------------------ */

/** Job statuses trades are allowed to move. Never touches on_hold/complete/collected. */
const STATUSES_TRADES_MAY_ADVANCE = new Set(['sold', 'materials', 'scheduled'])

export type DerivedJobSchedule = {
  scheduled_date: string | null
  install_days: number | null
  assigned_sub_id: string | null
  status: string
}

/**
 * Pure: what the job-level columns should say given its trades.
 *
 * - `scheduled_date`: the earliest scheduled active trade's date.
 * - `assigned_sub_id`: the roofing crew when roofing is scheduled (the legacy
 *   sub portal and RLS key off it), else the earliest trade's crew.
 * - `install_days`: that earliest trade's calendar-day span (integer column).
 * - status: sold/materials → scheduled once any trade is booked; scheduled →
 *   in_progress once any trade is done; scheduled → materials only
 *   when `revertToMaterials` (ops just took a booking OFF and nothing is booked
 *   or done) — never as a side effect of adding a trade, which would undo ops'
 *   own "Materials Ready — Schedule Job" click. Completing the JOB stays a
 *   manual step: 'complete' starts payroll materialization.
 */
export function deriveJobSchedule(
  job: { status: string },
  trades: Pick<JobTradeRow, 'trade' | 'status' | 'assigned_sub_id' | 'scheduled_date' | 'install_days'>[],
  opts: { revertToMaterials?: boolean } = {}
): DerivedJobSchedule {
  const active = trades.filter(isTradeActive)
  const scheduled = active
    .filter((t) => t.scheduled_date && t.assigned_sub_id)
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
  const earliest = scheduled[0] ?? null
  const roofing = scheduled.find((t) => t.trade === 'roofing') ?? null
  const completed = active.filter(isTradeComplete)
  const open = active.filter((t) => !isTradeComplete(t))

  let status = job.status
  if (STATUSES_TRADES_MAY_ADVANCE.has(job.status)) {
    // Any crew done moves the job on site — including the LAST crew, so the job
    // page offers "Mark Job Complete" rather than "Start Job".
    if (completed.length > 0) {
      status = 'in_progress'
    } else if (scheduled.length > 0 && (job.status === 'sold' || job.status === 'materials')) {
      status = 'scheduled'
    } else if (
      opts.revertToMaterials &&
      scheduled.length === 0 &&
      completed.length === 0 &&
      job.status === 'scheduled'
    ) {
      status = 'materials'
    }
  }

  return {
    scheduled_date: earliest?.scheduled_date ?? null,
    install_days: earliest ? calendarDaySpan(earliest.install_days) : null,
    assigned_sub_id: (roofing ?? earliest)?.assigned_sub_id ?? null,
    status,
  }
}
