/**
 * Lead intake rules (client-safe): who a new website lead goes to, and when an untouched lead counts as waiting.
 *
 * ONE place for both. Stored at `orgs.settings.leadIntake` (written only by PATCH /api/admin/lead-routing through
 * `mergeOrgSettings` at path ['leadIntake']) and, as an optional override per lead source, `lead_sources.routing`.
 *
 * Routing modes (Settings → Lead routing):
 * - person  : today's behavior and the default — the lead source's own person, else the company's lead owner
 *             (`orgs.settings.web_leads_owner_id`), else the longest-standing active admin. No rotation, nothing stored.
 * - rotate  : take turns among a chosen list. The turn is a stored pointer moved by the SQL function
 *             `lead_routing_next` under a row lock, so two leads arriving together never get the same turn.
 * - service : each service maps to ONE person or a turn group (a list of people: one = a person); a lead whose service
 *             matches no rule goes to the fallback.
 *
 * FALLBACK, always: the source's own person, then the company's lead owner, then the oldest active admin — the exact
 * chain `person` mode uses (resolveCompanyRecipient). A lead is never dropped for lack of a match.
 */

export const LEAD_INTAKE_SETTINGS_KEY = 'leadIntake'

export const ROUTING_MODES = ['person', 'rotate', 'service'] as const
export type RoutingMode = (typeof ROUTING_MODES)[number]

export type RoutingRule = { service: string; userIds: string[] }
export type LeadRouting = { mode: RoutingMode; userIds: string[]; rules: RoutingRule[] }

export const DEFAULT_ROUTING: LeadRouting = { mode: 'person', userIds: [], rules: [] }

export const MAX_ROUTING_PEOPLE = 25
export const MAX_ROUTING_RULES = 30
export const MAX_SERVICE_LEN = 60
export const MAX_SERVICE_OPTIONS = 20

/** A lead is untouched this many hours by default; owners set it (1 hour to 30 days). Plain hours, not business hours. */
export const DEFAULT_REMINDER_HOURS = 24
export const MIN_REMINDER_HOURS = 1
export const MAX_REMINDER_HOURS = 720

/** Only leads from the last 30 days are "waiting"; older ones are owner clean-up (same idea as Needs you's 14 days). */
export const LEADS_WAITING_WINDOW_DAYS = 30

/**
 * The hidden field every website-form snippet carries. People never see it, a bot fills it. Its mere presence in a
 * request marks the post as coming from the website form (rate limit, minimal checks); JSON integrations never send it.
 */
export const LEAD_FORM_HONEYPOT_FIELD = 'hp_check'
/** A form post: at most this many per visitor address per lead source in the window. */
/** The per-source daily cap when the company set none (shown as the placeholder; lib/lead-intake-db.ts enforces it). */
export const DEFAULT_FORM_DAILY_CAP = 200
export const DEFAULT_FORM_DAILY_CAP_LABEL = String(DEFAULT_FORM_DAILY_CAP)
export const LEAD_FORM_RATE_LIMIT = 5
export const LEAD_FORM_RATE_WINDOW_MS = 10 * 60 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/* ------------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------------ */

/** "Weekly Lawn  Care" / "weekly-lawn_care" → "weekly lawn care": how a service is compared everywhere. */
export function normalizeService(s: string): string {
  return s.toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The service a lead asked for, as stored on `leads.service_requested`: trimmed, one line, ≤ 80 chars; blank → null. */
export function cleanServiceRequested(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, 80)
  return s || null
}

/**
 * The structured service: the value only when it is one of the offered choices (matched ignoring case/spacing, returned as
 * written in the list); anything else → null. Free text a visitor typed or a bot posted never lands in the column — the
 * raw payload keeps it.
 */
export function matchServiceChoice(v: unknown, choices: readonly string[]): string | null {
  const s = cleanServiceRequested(v)
  if (!s) return null
  const key = normalizeService(s)
  return choices.find((c) => normalizeService(c) === key) ?? null
}

/** Stored `lead_sources.service_options` → the list (lenient: bad entries dropped). */
export function readServiceOptions(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (typeof x !== 'string') continue
    const s = x.replace(/\s+/g, ' ').trim()
    const key = normalizeService(s)
    if (!s || s.length > MAX_SERVICE_LEN || seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= MAX_SERVICE_OPTIONS) break
  }
  return out
}

/** A save of the choices (an array, or text one per line) → the list, or why not. Empty = no dropdown on the form. */
export function parseServiceOptions(v: unknown): { options: string[] } | { error: string } {
  const raw = typeof v === 'string' ? v.split(/\r?\n/) : Array.isArray(v) ? v : null
  if (!raw) return { error: 'Services must be a list' }
  const options: string[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x !== 'string') return { error: 'Services must be text' }
    const s = x.replace(/\s+/g, ' ').trim()
    if (!s) continue
    if (s.length > MAX_SERVICE_LEN) return { error: `Each service can be up to ${MAX_SERVICE_LEN} characters` }
    const key = normalizeService(s)
    if (seen.has(key)) continue
    seen.add(key)
    options.push(s)
  }
  if (options.length > MAX_SERVICE_OPTIONS) return { error: `Up to ${MAX_SERVICE_OPTIONS} services` }
  return { options }
}

/* ------------------------------------------------------------------------ *
 * Routing: parse, read, resolve
 * ------------------------------------------------------------------------ */

function uuidList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || !UUID_RE.test(x)) return null
    if (!out.includes(x)) out.push(x)
  }
  return out
}

/** Stored routing → a valid one, or null (bad shape → the caller uses its default). Lenient: a bad rule or id is dropped. */
export function readRouting(v: unknown): LeadRouting | null {
  if (!isObject(v) || !(ROUTING_MODES as readonly string[]).includes(v.mode as string)) return null
  const userIds = (Array.isArray(v.userIds) ? v.userIds : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
  const rules: RoutingRule[] = []
  const seen = new Set<string>()
  for (const r of Array.isArray(v.rules) ? v.rules : []) {
    if (!isObject(r) || typeof r.service !== 'string') continue
    const service = r.service.replace(/\s+/g, ' ').trim()
    const key = normalizeService(service)
    const ids = (Array.isArray(r.userIds) ? r.userIds : []).filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
    if (!service || seen.has(key) || ids.length === 0) continue
    seen.add(key)
    rules.push({ service, userIds: Array.from(new Set(ids)) })
  }
  return { mode: v.mode as RoutingMode, userIds: Array.from(new Set(userIds)), rules }
}

/** A save → a valid routing, or why not. Stricter than readRouting: a mode must have what it needs. */
export function parseRoutingPatch(v: unknown): { routing: LeadRouting } | { error: string } {
  if (!isObject(v)) return { error: 'Pick how leads are handed out' }
  const mode = v.mode
  if (typeof mode !== 'string' || !(ROUTING_MODES as readonly string[]).includes(mode)) return { error: 'Pick how leads are handed out' }
  const userIds = v.userIds === undefined ? [] : uuidList(v.userIds)
  if (!userIds) return { error: 'Pick people from your team' }
  if (userIds.length > MAX_ROUTING_PEOPLE) return { error: `Up to ${MAX_ROUTING_PEOPLE} people take turns` }
  const rules: RoutingRule[] = []
  if (v.rules !== undefined) {
    if (!Array.isArray(v.rules) || v.rules.length > MAX_ROUTING_RULES) return { error: `Up to ${MAX_ROUTING_RULES} services` }
    const seen = new Set<string>()
    for (const r of v.rules) {
      if (!isObject(r) || typeof r.service !== 'string') return { error: 'Each service needs a name' }
      const service = r.service.replace(/\s+/g, ' ').trim()
      if (!service || service.length > MAX_SERVICE_LEN) return { error: `Each service needs a name up to ${MAX_SERVICE_LEN} characters` }
      const key = normalizeService(service)
      if (seen.has(key)) return { error: `“${service}” is listed twice` }
      seen.add(key)
      const ids = uuidList(r.userIds)
      if (!ids || ids.length === 0) return { error: `Pick at least one person for “${service}”` }
      if (ids.length > MAX_ROUTING_PEOPLE) return { error: `Up to ${MAX_ROUTING_PEOPLE} people for “${service}”` }
      rules.push({ service, userIds: ids })
    }
  }
  if (mode === 'rotate' && userIds.length === 0) return { error: 'Pick at least one person to take turns' }
  if (mode === 'service' && rules.length === 0) return { error: 'Add at least one service and who gets it' }
  return { routing: { mode: mode as RoutingMode, userIds, rules } }
}

/** The rule for a lead's service, matched ignoring case, spaces and - _ /; null when no service or no rule. */
export function findRuleForService(rules: readonly RoutingRule[], service: string | null | undefined): RoutingRule | null {
  if (!service) return null
  const key = normalizeService(service)
  return key ? rules.find((r) => normalizeService(r.service) === key) ?? null : null
}

/** Moves the stored turn pointer for `scope` and returns whose turn it is (null: nobody in the list can take a lead). */
export type NextInRotation = (scope: string, userIds: string[]) => Promise<string | null>

export type RouteInput = {
  /** The source's own override when it has one, else the company's. */
  routing: LeadRouting
  /** 'org' for the company's setting, `source:<id>` when the source has its own: separate turn pointers. */
  scopeBase: string
  service: string | null
  /** `lead_sources.auto_assign_user_id` — the source's own person. */
  sourceUserId: string | null | undefined
  /** `orgs.settings.web_leads_owner_id` — the company's lead owner. */
  fallbackUserId: string | null | undefined
}

/**
 * The people to try, in order. Pass the result to resolveCompanyRecipient, which keeps the first one that is an ACTIVE
 * user of this company and ends on the oldest active admin — so the list never needs the admin and never comes up empty.
 * `person` mode adds nothing in front of the fallback, i.e. it is exactly the old rule.
 */
export async function routeLeadCandidates(input: RouteInput, next: NextInRotation): Promise<string[]> {
  const { routing } = input
  let routed: string | null = null
  if (routing.mode === 'rotate' && routing.userIds.length > 0) {
    routed = await next(`${input.scopeBase}:rotate`, routing.userIds)
  } else if (routing.mode === 'service') {
    const rule = findRuleForService(routing.rules, input.service)
    if (rule) {
      routed = rule.userIds.length === 1 ? rule.userIds[0] : await next(`${input.scopeBase}:service:${normalizeService(rule.service)}`, rule.userIds)
    }
  }
  return [routed, input.sourceUserId, input.fallbackUserId].filter((x): x is string => typeof x === 'string' && x.trim() !== '')
}

/* ------------------------------------------------------------------------ *
 * Company settings
 * ------------------------------------------------------------------------ */

export type LeadIntakeSettings = {
  routing: LeadRouting
  /** Remind the office about leads nobody has contacted. OFF until an owner turns it on. */
  reminderEnabled: boolean
  reminderHours: number
}

export function parseReminderHours(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isInteger(n) || n < MIN_REMINDER_HOURS || n > MAX_REMINDER_HOURS) return null
  return n
}

/** `orgs.settings` → this company's intake settings. Nothing stored = today's behavior (person, reminders off, 24 h). */
export function readLeadIntakeSettings(settings: unknown): LeadIntakeSettings {
  const s = isObject(settings) && isObject(settings[LEAD_INTAKE_SETTINGS_KEY]) ? (settings[LEAD_INTAKE_SETTINGS_KEY] as Record<string, unknown>) : {}
  return {
    routing: readRouting(s) ?? { ...DEFAULT_ROUTING },
    reminderEnabled: s.reminderEnabled === true,
    reminderHours: parseReminderHours(s.reminderHours) ?? DEFAULT_REMINDER_HOURS,
  }
}

export type LeadIntakePatch = {
  /** Keys to merge at `orgs.settings.leadIntake`. */
  set: Record<string, unknown>
  /** The company's lead owner (`orgs.settings.web_leads_owner_id`); null clears it. Undefined = leave alone. */
  leadOwnerId?: string | null
  /** Per-source overrides: routing null = use the company's setting. */
  sources: Array<{ id: string; routing: LeadRouting | null; autoAssignUserId?: string | null }>
}

/** A save from the Lead routing screen → what to write, or why not. People are checked against the company by the route. */
export function parseLeadIntakePatch(body: unknown): LeadIntakePatch | { error: string } {
  const b = isObject(body) ? body : {}
  const out: LeadIntakePatch = { set: {}, sources: [] }
  if (b.routing !== undefined) {
    const parsed = parseRoutingPatch(b.routing)
    if ('error' in parsed) return parsed
    out.set.mode = parsed.routing.mode
    out.set.userIds = parsed.routing.userIds
    out.set.rules = parsed.routing.rules
  }
  if (b.reminder !== undefined) {
    if (!isObject(b.reminder)) return { error: 'Reminder settings are not valid' }
    if (b.reminder.enabled !== undefined) {
      if (typeof b.reminder.enabled !== 'boolean') return { error: 'Reminder must be on or off' }
      out.set.reminderEnabled = b.reminder.enabled
    }
    if (b.reminder.hours !== undefined) {
      const hours = parseReminderHours(b.reminder.hours)
      if (hours == null) return { error: `Hours must be a whole number from ${MIN_REMINDER_HOURS} to ${MAX_REMINDER_HOURS}` }
      out.set.reminderHours = hours
    }
  }
  if (b.leadOwnerId !== undefined) {
    if (b.leadOwnerId !== null && !(typeof b.leadOwnerId === 'string' && UUID_RE.test(b.leadOwnerId))) return { error: 'Pick a person from your team' }
    out.leadOwnerId = b.leadOwnerId as string | null
  }
  if (b.sources !== undefined) {
    if (!Array.isArray(b.sources) || b.sources.length > 200) return { error: 'Lead sources are not valid' }
    for (const s of b.sources) {
      if (!isObject(s) || typeof s.id !== 'string' || !UUID_RE.test(s.id)) return { error: 'Lead sources are not valid' }
      let routing: LeadRouting | null = null
      if (s.routing !== null && s.routing !== undefined) {
        const parsed = parseRoutingPatch(s.routing)
        if ('error' in parsed) return parsed
        routing = parsed.routing
      }
      if (s.autoAssignUserId !== undefined && s.autoAssignUserId !== null && !(typeof s.autoAssignUserId === 'string' && UUID_RE.test(s.autoAssignUserId))) {
        return { error: 'Pick a person from your team' }
      }
      out.sources.push({ id: s.id, routing, ...(s.autoAssignUserId !== undefined ? { autoAssignUserId: s.autoAssignUserId as string | null } : {}) })
    }
  }
  if (Object.keys(out.set).length === 0 && out.leadOwnerId === undefined && out.sources.length === 0) return { error: 'Nothing to save' }
  return out
}

/** Every person id a patch names — the route checks they all belong to this company before anything is written. */
export function patchUserIds(p: LeadIntakePatch): string[] {
  const ids = new Set<string>()
  const add = (xs: readonly string[] | undefined) => xs?.forEach((x) => ids.add(x))
  add(p.set.userIds as string[] | undefined)
  for (const r of (p.set.rules as RoutingRule[] | undefined) ?? []) add(r.userIds)
  if (p.leadOwnerId) ids.add(p.leadOwnerId)
  for (const s of p.sources) {
    if (s.routing) {
      add(s.routing.userIds)
      for (const r of s.routing.rules) add(r.userIds)
    }
    if (s.autoAssignUserId) ids.add(s.autoAssignUserId)
  }
  return Array.from(ids)
}

/** People who must be ACTIVE: the single-person pickers (company lead owner, a source's person). Rotation lists are handled by dropInactiveFromRotations. */
export function patchSinglePersonIds(p: LeadIntakePatch): string[] {
  const ids = new Set<string>()
  if (p.leadOwnerId) ids.add(p.leadOwnerId)
  for (const s of p.sources) if (s.autoAssignUserId) ids.add(s.autoAssignUserId)
  return Array.from(ids)
}

/**
 * Take people who are no longer active out of every rotation / service list in a patch (instead of refusing the save).
 * Returns the cleaned patch and the ids that were removed, so the screen can say so.
 */
export function dropInactiveFromRotations(p: LeadIntakePatch, isActive: (id: string) => boolean): { patch: LeadIntakePatch; removed: string[] } {
  const removed = new Set<string>()
  const keep = (ids: string[]) => ids.filter((id) => (isActive(id) ? true : (removed.add(id), false)))
  const rules = (rs: RoutingRule[]) => rs.map((r) => ({ ...r, userIds: keep(r.userIds) }))
  const set = { ...p.set }
  if (Array.isArray(set.userIds)) set.userIds = keep(set.userIds as string[])
  if (Array.isArray(set.rules)) set.rules = rules(set.rules as RoutingRule[])
  const sources = p.sources.map((s) => (s.routing ? { ...s, routing: { ...s.routing, userIds: keep(s.routing.userIds), rules: rules(s.routing.rules) } } : s))
  return { patch: { ...p, set, sources }, removed: Array.from(removed) }
}

/** Who may change routing: the same people who change job catch-up and checkups (admins and owners). */
export { canEditJobCatchUpSettings as canEditLeadIntake } from '@/lib/job-catch-up-settings'
