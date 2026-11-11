import { INDUSTRY_PROFILES } from '@/lib/industry-profiles'
import { addWorkdays, isWorkday, moveStage, nextWorkdayOnOrAfter, pushLate, scheduleFromTemplate, setStageWorkdays, stageEnd, validateStages, workdaysBetween, type ScheduleStage, type ScheduleTemplate } from '@/lib/job-schedule'

const T: ScheduleTemplate = {
  id: 't',
  label: 'T',
  stages: [
    { key: 'a', name: 'A', workdays: 3, dependsOn: [] },
    { key: 'b', name: 'B', workdays: 2, dependsOn: ['a'] },
    { key: 'c', name: 'C', workdays: 2, dependsOn: ['a'] },
    { key: 'd', name: 'D', workdays: 1, dependsOn: ['b', 'c'] },
  ],
}
const plan = () => scheduleFromTemplate(T, '2026-03-02') as ScheduleStage[] // a Monday
const by = (s: ScheduleStage[], k: string) => s.find((x) => x.key === k)!

describe('workday math', () => {
  it('skips weekends', () => {
    expect(isWorkday('2026-03-07')).toBe(false)
    expect(nextWorkdayOnOrAfter('2026-03-07')).toBe('2026-03-09')
    expect(addWorkdays('2026-03-06', 1)).toBe('2026-03-09')
    expect(addWorkdays('2026-03-09', -1)).toBe('2026-03-06')
    expect(workdaysBetween('2026-03-02', '2026-03-09')).toBe(5)
    expect(workdaysBetween('2026-03-09', '2026-03-02')).toBe(-5)
    expect(stageEnd({ start: '2026-03-05', workdays: 3 })).toBe('2026-03-09')
  })
})

describe('template → dates', () => {
  it('each stage starts the workday after what it waits for; parallel stages start together', () => {
    const s = plan()
    expect(by(s, 'a')).toMatchObject({ start: '2026-03-02' })
    expect(by(s, 'b').start).toBe('2026-03-05')
    expect(by(s, 'c').start).toBe('2026-03-05')
    expect(by(s, 'd').start).toBe('2026-03-09') // b,c end Fri 3/6 → Monday
  })
  it('a start on a weekend begins the next Monday', () => {
    expect((scheduleFromTemplate(T, '2026-03-07') as ScheduleStage[])[0].start).toBe('2026-03-09')
  })
  it('rejects loops and unknown dependencies', () => {
    expect(validateStages([{ key: 'a', dependsOn: ['b'] }, { key: 'b', dependsOn: ['a'] }])).toMatch(/loop/)
    expect(validateStages([{ key: 'a', dependsOn: ['zzz'] }])).toMatch(/not in the plan/)
    expect(validateStages([{ key: 'a', dependsOn: ['a'] }])).toMatch(/itself/)
    expect(scheduleFromTemplate({ id: 'x', label: 'x', stages: [{ key: 'a', name: 'A', workdays: 1, dependsOn: ['b'] }, { key: 'b', name: 'B', workdays: 1, dependsOn: ['a'] }] }, '2026-03-02')).toHaveProperty('error')
  })
  it('maps trade labels to the company trade slug', () => {
    const t: ScheduleTemplate = { id: 'x', label: 'x', stages: [{ key: 'f', name: 'F', tradeLabel: 'Framing', workdays: 1, dependsOn: [] }, { key: 'p', name: 'P', workdays: 1, dependsOn: [] }] }
    const s = scheduleFromTemplate(t, '2026-03-02', (l) => (l === 'Framing' ? 'framing' : null)) as ScheduleStage[]
    expect(s.map((x) => x.trade)).toEqual(['framing', null])
  })
})

describe('moving a stage', () => {
  it('shifts the stage and everything that depends on it by the same workdays', () => {
    const r = moveStage(plan(), 'a', '2026-03-04') // +2 workdays
    expect(by(r.stages, 'a').start).toBe('2026-03-04')
    expect(by(r.stages, 'b').start).toBe('2026-03-09')
    expect(by(r.stages, 'c').start).toBe('2026-03-09')
    expect(by(r.stages, 'd').start).toBe('2026-03-11')
    expect(r.clamped).toBe(false)
  })
  it('moving a middle stage later leaves its dependency alone and pushes only its dependents', () => {
    const r = moveStage(plan(), 'b', '2026-03-10')
    expect(by(r.stages, 'a').start).toBe('2026-03-02')
    expect(by(r.stages, 'c').start).toBe('2026-03-05')
    expect(by(r.stages, 'b').start).toBe('2026-03-10')
    expect(by(r.stages, 'd').start).toBe('2026-03-12') // b ends 3/11 → d the day after
  })
  it('cannot start before what it waits on ends (clamped)', () => {
    const r = moveStage(plan(), 'b', '2026-03-02')
    expect(r.clamped).toBe(true)
    expect(by(r.stages, 'b').start).toBe('2026-03-05')
  })
  it('a weekend drop lands on Monday; unknown key changes nothing', () => {
    expect(by(moveStage(plan(), 'a', '2026-03-07').stages, 'a').start).toBe('2026-03-09')
    expect(moveStage(plan(), 'zzz', '2026-03-09').changed).toEqual([])
  })
  it('a parallel dependency that did not move still holds a moved stage back', () => {
    // d waits on b AND c; pull b earlier is clamped, push c later → d follows c.
    const r = moveStage(plan(), 'c', '2026-03-12')
    expect(by(r.stages, 'd').start).toBe('2026-03-16')
  })
  it('does not mutate its input', () => {
    const p = plan()
    const before = JSON.stringify(p)
    moveStage(p, 'a', '2026-03-10')
    expect(JSON.stringify(p)).toBe(before)
  })
})

describe('changing a length', () => {
  it('a longer stage pushes what waits on it later; a shorter one never pulls anything earlier', () => {
    const longer = setStageWorkdays(plan(), 'a', 5)
    expect(by(longer.stages, 'b').start).toBe('2026-03-09')
    const shorter = setStageWorkdays(plan(), 'a', 1)
    expect(by(shorter.stages, 'b').start).toBe('2026-03-05')
  })
  it('clamps to 1..365', () => {
    expect(by(setStageWorkdays(plan(), 'a', 0).stages, 'a').workdays).toBe(1)
    expect(by(setStageWorkdays(plan(), 'a', 9999).stages, 'a').workdays).toBe(365)
  })
  it('pushLate never moves a stage earlier', () => {
    const s = plan().map((x) => (x.key === 'd' ? { ...x, start: '2026-06-01' } : x))
    expect(by(pushLate(s), 'd').start).toBe('2026-06-01')
  })
})

describe('home builder profile templates', () => {
  const templates = INDUSTRY_PROFILES.home_builder.scheduleTemplates ?? []
  it('are valid and schedulable', () => {
    expect(templates.length).toBeGreaterThanOrEqual(2)
    for (const t of templates) {
      expect(validateStages(t.stages)).toBeNull()
      const s = scheduleFromTemplate(t, '2026-03-02')
      expect(Array.isArray(s)).toBe(true)
    }
  })
  it('trade labels exist in the profile trades', () => {
    const labels = new Set((INDUSTRY_PROFILES.home_builder.trades ?? []).map((x) => x.label))
    for (const t of templates) for (const s of t.stages) if (s.tradeLabel) expect(labels.has(s.tradeLabel)).toBe(true)
  })
  it('turns project tools on for home builders only', () => {
    expect(INDUSTRY_PROFILES.home_builder.features.projectTools).toBe(true)
    expect(INDUSTRY_PROFILES.roofing.features.projectTools).toBeUndefined()
  })
})
