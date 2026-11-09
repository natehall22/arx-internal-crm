/**
 * Customer checkup schedule (client-safe). Stored as top-level `orgs.settings` keys, written only by
 * PATCH /api/admin/settings `type: 'checkups'` (admins / owners) through `mergeOrgSettings`; the generic
 * `type: 'settings'` save strips these keys. The schedule logic itself is lib/checkups.ts.
 *
 * Default (Nathan, 2026-11-09): inspections 6 and 12 months after install, then a call/text every 12 months.
 * OFF unless an org turns it on.
 */
import { canEditJobCatchUpSettings } from '@/lib/job-catch-up-settings'

export const CHECKUPS_ENABLED_KEY = 'checkups_enabled'
export const CHECKUPS_INSPECTION_MONTHS_KEY = 'checkups_inspection_months'
export const CHECKUPS_TOUCH_EVERY_MONTHS_KEY = 'checkups_touch_every_months'
export const CHECKUPS_ASSIGNEE_KEY = 'checkups_assignee_user_id'
export const CHECKUPS_SETTINGS_KEYS: readonly string[] = [
  CHECKUPS_ENABLED_KEY,
  CHECKUPS_INSPECTION_MONTHS_KEY,
  CHECKUPS_TOUCH_EVERY_MONTHS_KEY,
  CHECKUPS_ASSIGNEE_KEY,
]

export const DEFAULT_INSPECTION_MONTHS: readonly number[] = [6, 12]
export const DEFAULT_TOUCH_EVERY_MONTHS = 12
export const MAX_MONTH_OFFSET = 600
/** A checkup row is created this many days before it is due, so it can be booked ahead. */
export const CHECKUP_LEAD_DAYS = 30

export type CheckupSettings = {
  enabled: boolean
  inspectionMonths: number[]
  /** 0 = no calls/texts after the last inspection. */
  touchEveryMonths: number
  assigneeUserId: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 1–4 distinct whole months from 1 to 120, ascending; anything else → null. */
export function parseInspectionMonths(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length > 4) return null
  const out: number[] = []
  for (const x of v) {
    const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
    if (!Number.isInteger(n) || n < 1 || n > 120) return null
    if (!out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

export function parseTouchEveryMonths(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isInteger(n) || n < 0 || n > 60) return null
  return n
}

export function readCheckupSettings(settings: unknown): CheckupSettings {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const assignee = s[CHECKUPS_ASSIGNEE_KEY]
  return {
    enabled: s[CHECKUPS_ENABLED_KEY] === true,
    inspectionMonths: parseInspectionMonths(s[CHECKUPS_INSPECTION_MONTHS_KEY]) ?? [...DEFAULT_INSPECTION_MONTHS],
    touchEveryMonths: parseTouchEveryMonths(s[CHECKUPS_TOUCH_EVERY_MONTHS_KEY]) ?? DEFAULT_TOUCH_EVERY_MONTHS,
    assigneeUserId: typeof assignee === 'string' && UUID_RE.test(assignee) ? assignee : null,
  }
}

/** Same people who set job catch-up: admins (admin/owner role) and owners. */
export const canEditCheckupSettings = canEditJobCatchUpSettings

/** A save from the Settings card → the keys to merge, or why not. The assignee is checked against the org by the route. */
export function parseCheckupPatch(body: unknown): { set: Record<string, unknown> } | { error: string } {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
  const set: Record<string, unknown> = {}
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') return { error: 'enabled must be true or false' }
    set[CHECKUPS_ENABLED_KEY] = b.enabled
  }
  if (b.inspectionMonths !== undefined) {
    const months = parseInspectionMonths(b.inspectionMonths)
    if (!months || months.length === 0) return { error: 'Inspections: 1 to 4 different months, each from 1 to 120' }
    set[CHECKUPS_INSPECTION_MONTHS_KEY] = months
  }
  if (b.touchEveryMonths !== undefined) {
    const n = parseTouchEveryMonths(b.touchEveryMonths)
    if (n == null) return { error: 'Calls/texts: every 0 to 60 months (0 = none)' }
    set[CHECKUPS_TOUCH_EVERY_MONTHS_KEY] = n
  }
  if (b.assigneeUserId !== undefined) {
    if (b.assigneeUserId !== null && !(typeof b.assigneeUserId === 'string' && UUID_RE.test(b.assigneeUserId))) {
      return { error: 'Pick a person to assign checkups to' }
    }
    set[CHECKUPS_ASSIGNEE_KEY] = b.assigneeUserId
  }
  if (Object.keys(set).length === 0) return { error: 'Nothing to save' }
  return { set }
}

/** Months after install at which a checkup falls due, up to `throughMonths`. Inspections first, then touches. */
export function checkupOffsets(s: Pick<CheckupSettings, 'inspectionMonths' | 'touchEveryMonths'>, throughMonths: number): Array<{ month: number; kind: 'inspection' | 'touch' }> {
  const out: Array<{ month: number; kind: 'inspection' | 'touch' }> = []
  for (const m of s.inspectionMonths) if (m <= throughMonths) out.push({ month: m, kind: 'inspection' })
  if (s.touchEveryMonths > 0) {
    const start = s.inspectionMonths.length ? s.inspectionMonths[s.inspectionMonths.length - 1] : 0
    for (let m = start + s.touchEveryMonths; m <= Math.min(throughMonths, MAX_MONTH_OFFSET); m += s.touchEveryMonths) {
      out.push({ month: m, kind: 'touch' })
    }
  }
  return out
}

/** `ymd` + whole months, clamped to the month's last day (Aug 31 + 6 → Feb 28/29). */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Whole months from `fromYmd` to `toYmd` (floor; negative if `to` is earlier). */
export function monthsBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  let n = (ty - fy) * 12 + (tm - fm)
  if (td < fd) n -= 1
  return n
}

export const CHECKUP_KIND_LABELS = { inspection: 'Inspection', touch: 'Call / text' } as const

export function checkupLabel(row: { kind: 'inspection' | 'touch'; month_offset: number }): string {
  const when = row.month_offset % 12 === 0 ? `${row.month_offset / 12}-year` : `${row.month_offset}-month`
  return `${when} ${row.kind === 'inspection' ? 'inspection' : 'check-in call'}`
}
