/**
 * Job schedule stages (project tools). PURE, client-safe — dates are 'YYYY-MM-DD' strings, durations are WORKDAYS (Mon–Fri).
 *
 * A stage = name, workdays, "starts after" (depends on) other stages. A profile seeds templates; applying one to a job
 * creates the stages' dates. This is a PLAN: the crew actually booked for a trade stays on its work_orders row (existing
 * install scheduling, lib/job-trades-db.ts) — the timeline shows the booked date over the plan when there is one.
 * Rules (small on purpose — no Gantt engine): a stage never starts before the day after what it depends on ends; moving a
 * stage moves everything that depends on it by the same number of workdays.
 */

export type ScheduleTemplateStage = {
  key: string
  name: string
  /** A trade LABEL from the company's trades ("Framing"); matched case-insensitively when applied, none = no crew. */
  tradeLabel?: string
  workdays: number
  dependsOn: string[]
}
export type ScheduleTemplate = { id: string; label: string; stages: ScheduleTemplateStage[] }

export type ScheduleStage = {
  key: string
  name: string
  trade: string | null
  start: string
  workdays: number
  dependsOn: string[]
  doneAt?: string | null
}

const DAY_MS = 86400000

function parse(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
export function isYmd(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && fmt(parse(v)) === v
}
export function isWorkday(ymd: string): boolean {
  const dow = parse(ymd).getUTCDay()
  return dow !== 0 && dow !== 6
}
/** The same day if it is a workday, else the next Monday. */
export function nextWorkdayOnOrAfter(ymd: string): string {
  let d = parse(ymd)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() + DAY_MS)
  return fmt(d)
}
/** `ymd` moved by `n` workdays (negative = back). `ymd` should be a workday. */
export function addWorkdays(ymd: string, n: number): string {
  let d = parse(nextWorkdayOnOrAfter(ymd))
  let left = Math.abs(Math.trunc(n))
  const step = n < 0 ? -1 : 1
  while (left > 0) {
    d = new Date(d.getTime() + step * DAY_MS)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1
  }
  return fmt(d)
}
/** Workdays from a to b (b later = positive). Both treated as workdays. */
export function workdaysBetween(a: string, b: string): number {
  const x = nextWorkdayOnOrAfter(a)
  const y = nextWorkdayOnOrAfter(b)
  if (x === y) return 0
  const dir = y > x ? 1 : -1
  let n = 0
  let d = parse(x)
  const end = parse(y)
  while (d.getTime() !== end.getTime()) {
    d = new Date(d.getTime() + dir * DAY_MS)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += dir
  }
  return n
}
/** The last working day of a stage. */
export function stageEnd(s: Pick<ScheduleStage, 'start' | 'workdays'>): string {
  return addWorkdays(s.start, Math.max(1, s.workdays) - 1)
}

/** Why a stage list can't be scheduled (unknown "starts after", or a loop); null = fine. */
export function validateStages(stages: ReadonlyArray<Pick<ScheduleStage, 'key' | 'dependsOn'>>): string | null {
  const keys = new Set(stages.map((s) => s.key))
  if (keys.size !== stages.length) return 'Two stages have the same name key'
  for (const s of stages) for (const d of s.dependsOn) {
    if (!keys.has(d)) return 'A stage starts after something that is not in the plan'
    if (d === s.key) return 'A stage cannot start after itself'
  }
  return topoOrder(stages) ? null : 'The stages loop (A waits for B and B waits for A)'
}

function topoOrder<T extends Pick<ScheduleStage, 'key' | 'dependsOn'>>(stages: ReadonlyArray<T>): T[] | null {
  const byKey = new Map(stages.map((s) => [s.key, s]))
  const out: T[] = []
  const state = new Map<string, 1 | 2>()
  let ok = true
  const visit = (s: T) => {
    const st = state.get(s.key)
    if (st === 2) return
    if (st === 1) { ok = false; return }
    state.set(s.key, 1)
    for (const d of s.dependsOn) { const dep = byKey.get(d); if (dep) visit(dep) }
    state.set(s.key, 2)
    out.push(s)
  }
  for (const s of stages) visit(s)
  return ok ? out : null
}

/** Never earlier than the day after every dependency ends. Only ever pushes LATER. Returns a new list in the input order. */
export function pushLate(stages: ReadonlyArray<ScheduleStage>): ScheduleStage[] {
  const order = topoOrder(stages)
  if (!order) return stages.map((s) => ({ ...s }))
  const byKey = new Map(stages.map((s) => [s.key, { ...s }]))
  for (const s of order) {
    const cur = byKey.get(s.key) as ScheduleStage
    let min = nextWorkdayOnOrAfter(cur.start)
    for (const d of cur.dependsOn) {
      const dep = byKey.get(d)
      if (!dep) continue
      const after = addWorkdays(stageEnd(dep), 1)
      if (after > min) min = after
    }
    cur.start = min
  }
  return stages.map((s) => byKey.get(s.key) as ScheduleStage)
}

/** Template → stages with dates: each starts the first workday after what it waits for (the first ones on `startYmd`). */
export function scheduleFromTemplate(template: ScheduleTemplate, startYmd: string, tradeSlugFor: (label: string) => string | null = () => null): ScheduleStage[] | { error: string } {
  const err = validateStages(template.stages)
  if (err) return { error: err }
  const base = nextWorkdayOnOrAfter(startYmd)
  const stages: ScheduleStage[] = template.stages.map((t) => ({
    key: t.key, name: t.name, trade: t.tradeLabel ? tradeSlugFor(t.tradeLabel) : null, start: base, workdays: Math.max(1, Math.round(t.workdays)), dependsOn: [...t.dependsOn],
  }))
  return pushLate(stages)
}

function dependentsOf(stages: ReadonlyArray<ScheduleStage>, key: string): Set<string> {
  const out = new Set<string>()
  const queue = [key]
  while (queue.length) {
    const k = queue.pop() as string
    for (const s of stages) if (s.dependsOn.includes(k) && !out.has(s.key)) { out.add(s.key); queue.push(s.key) }
  }
  return out
}

/**
 * Move one stage to `newStart` (rounded to a workday; not before what it depends on ends). Everything that depends on it moves
 * by the same number of workdays. `clamped` = the date was held back by a dependency.
 */
export function moveStage(stages: ReadonlyArray<ScheduleStage>, key: string, newStartYmd: string): { stages: ScheduleStage[]; clamped: boolean; changed: string[] } {
  const target = stages.find((s) => s.key === key)
  if (!target) return { stages: stages.map((s) => ({ ...s })), clamped: false, changed: [] }
  let want = nextWorkdayOnOrAfter(newStartYmd)
  let minStart = want
  for (const d of target.dependsOn) {
    const dep = stages.find((s) => s.key === d)
    if (dep) { const after = addWorkdays(stageEnd(dep), 1); if (after > minStart) minStart = after }
  }
  const clamped = minStart > want
  want = minStart
  const delta = workdaysBetween(target.start, want)
  const moving = dependentsOf(stages, key)
  const next = stages.map((s) => {
    if (s.key === key) return { ...s, start: want }
    if (moving.has(s.key)) return { ...s, start: addWorkdays(s.start, delta) }
    return { ...s }
  })
  // A parallel dependency that did NOT move can still force a moved stage later.
  const settled = pushLate(next)
  const changed = settled.filter((s, i) => s.start !== stages[i].start).map((s) => s.key)
  return { stages: settled, clamped, changed }
}

/** Change a stage's length; whatever waits on it is pushed later if it now overlaps (never pulled earlier). */
export function setStageWorkdays(stages: ReadonlyArray<ScheduleStage>, key: string, workdays: number): { stages: ScheduleStage[]; changed: string[] } {
  const n = Math.min(365, Math.max(1, Math.round(workdays)))
  const next = pushLate(stages.map((s) => (s.key === key ? { ...s, workdays: n } : { ...s })))
  return { stages: next, changed: next.filter((s, i) => s.start !== stages[i].start || s.workdays !== stages[i].workdays).map((s) => s.key) }
}

export function scheduleSpan(stages: ReadonlyArray<ScheduleStage>): { start: string; end: string } | null {
  if (stages.length === 0) return null
  let start = stages[0].start
  let end = stageEnd(stages[0])
  for (const s of stages) {
    if (s.start < start) start = s.start
    const e = stageEnd(s)
    if (e > end) end = e
  }
  return { start, end }
}

export function slugifyStageKey(name: string, taken: ReadonlySet<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'stage'
  let key = base
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`
  return key
}
