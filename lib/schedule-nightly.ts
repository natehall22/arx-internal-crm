/**
 * Nightly auto-roll + end-of-day nudge — the company's settings (pure, client-safe). Stored at `orgs.settings.scheduling`
 * = { autoRoll: { enabled, hour }, endOfDay: { enabled, hour } }, written ONLY by PATCH /api/admin/scheduling-nightly (owners,
 * mergeOrgSettings path ['scheduling']; the generic settings save strips it). Nothing stored = both OFF, so a company that never
 * turns them on is untouched. Hours are 0–23 in the company's own time zone.
 */
export const SCHEDULING_SETTINGS_KEY = 'scheduling'

export type NightlySettings = {
  /** Move unstarted work dated before today to the next working day. `hour` = the earliest local hour it runs. */
  autoRoll: { enabled: boolean; hour: number }
  /** Bell the crew leads / office about visits still open and people still clocked in. `hour` = the local hour. */
  endOfDay: { enabled: boolean; hour: number }
}

export const DEFAULT_NIGHTLY_SETTINGS: NightlySettings = { autoRoll: { enabled: false, hour: 1 }, endOfDay: { enabled: false, hour: 18 } }

/** How many hourly runs after the set hour may still do the job (a late or missed run must not skip the day). Idempotent either way. */
export const RUN_WINDOW_HOURS = 3

const hourOf = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : fallback)

export function readNightlySettings(stored: unknown): NightlySettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const one = (v: unknown, d: { enabled: boolean; hour: number }) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
    return { enabled: o.enabled === true, hour: hourOf(o.hour, d.hour) }
  }
  return { autoRoll: one(s.autoRoll, DEFAULT_NIGHTLY_SETTINGS.autoRoll), endOfDay: one(s.endOfDay, DEFAULT_NIGHTLY_SETTINGS.endOfDay) }
}

/** A PATCH body → the keys to merge. Anything not named is left as it is; an unknown shape is an error. */
export function parseNightlyPatch(body: unknown): { set: Partial<NightlySettings> } | { error: string } {
  const b = (body && typeof body === 'object' ? (body as Record<string, unknown>).scheduling : null) as Record<string, unknown> | null
  if (!b || typeof b !== 'object') return { error: 'Nothing to save' }
  const set: Partial<NightlySettings> = {}
  for (const key of ['autoRoll', 'endOfDay'] as const) {
    if (b[key] === undefined) continue
    const v = b[key] as Record<string, unknown> | null
    if (!v || typeof v !== 'object' || typeof v.enabled !== 'boolean') return { error: 'Turn it on or off' }
    if (v.hour !== undefined && hourOf(v.hour, -1) === -1) return { error: 'Pick an hour from 0 to 23' }
    set[key] = { enabled: v.enabled, hour: hourOf(v.hour, DEFAULT_NIGHTLY_SETTINGS[key].hour) }
  }
  return Object.keys(set).length ? { set } : { error: 'Nothing to save' }
}

/** Is the company's local `hour` inside the run window that starts at its configured hour? (No wrap past midnight: 23 runs at 23 only.) */
export function inRunWindow(hour: number, configured: number): boolean {
  return hour >= configured && hour < configured + RUN_WINDOW_HOURS
}
