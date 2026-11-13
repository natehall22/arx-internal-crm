import { parseCheckupPatch, parseInspectionMonths, parseTouchEveryMonths, readCheckupSettings } from '@/lib/checkups-settings'
import { addChipNumber, removeChipNumber } from '@/lib/chip-numbers'
import { INSPECTION_CHIP_RULES, INSPECTION_PRESET_MONTHS, checkupExample, touchLabel, touchOptions } from '@/lib/checkups-settings-ui'

const addInspectionMonth = (l: number[], raw: unknown) => {
  const r = addChipNumber(l, raw, INSPECTION_CHIP_RULES)
  return 'values' in r ? { months: r.values } : r
}
const removeInspectionMonth = removeChipNumber

describe('check-in choices', () => {
  it('maps the four plain choices to the stored numbers', () => {
    expect(touchOptions(12).map((o) => [o.label, o.value])).toEqual([['Never', 0], ['Every 6 months', 6], ['Every year', 12], ['Every 2 years', 24]])
  })

  it('a stored value that is not one of the four is kept and shown as "Every N months"', () => {
    for (const n of [1, 3, 18, 36, 60]) {
      const opts = touchOptions(n)
      expect(opts).toHaveLength(5)
      expect(opts[4].value).toBe(n)
      expect(parseTouchEveryMonths(opts[4].value)).toBe(n)
    }
    expect(touchLabel(18)).toBe('Every 18 months')
    expect(touchLabel(1)).toBe('Every month')
  })

  it('every choice, and a custom stored value, round-trips through storage unchanged', () => {
    for (const n of [0, 6, 12, 24, 18]) {
      const patch = parseCheckupPatch({ touchEveryMonths: n })
      expect('set' in patch && readCheckupSettings(patch.set).touchEveryMonths).toBe(n)
    }
  })
})

describe('inspection chips', () => {
  it('presets are all valid months', () => {
    expect(INSPECTION_PRESET_MONTHS).toEqual([3, 6, 9, 12, 18, 24])
    expect(parseInspectionMonths([...INSPECTION_PRESET_MONTHS].slice(0, 4))).not.toBeNull()
  })

  it('adds in ascending order and keeps the server limits (1-4, whole months 1-120, no duplicates)', () => {
    expect(addInspectionMonth([6, 12], 9)).toEqual({ months: [6, 9, 12] })
    expect(addInspectionMonth([6, 12], '15')).toEqual({ months: [6, 12, 15] })
    expect(addInspectionMonth([6, 12], 120)).toEqual({ months: [6, 12, 120] })
    for (const bad of [0, 121, 1.5, 'abc', '', '-3', '6, 9']) expect(addInspectionMonth([6, 12], bad)).toHaveProperty('error')
    expect(addInspectionMonth([6, 12], 12)).toHaveProperty('error')
    expect(addInspectionMonth([3, 6, 9, 12], 18)).toHaveProperty('error')
  })

  it('what the card sends is accepted by the save route parser', () => {
    const r = addInspectionMonth([6, 12], 9)
    const months = 'months' in r ? r.months : []
    expect(parseCheckupPatch({ inspectionMonths: months })).toEqual({ set: { checkups_inspection_months: [6, 9, 12] } })
    expect(removeInspectionMonth([6, 9, 12], 9)).toEqual([6, 12])
  })
})

describe('live example', () => {
  it('uses the day passed in (the company\'s today), never the machine clock', () => {
    expect(checkupExample({ inspectionMonths: [6, 12], touchEveryMonths: 12 }, '2026-11-12')).toBe('Example: a job finished today gets inspections in May 2027 and Nov 2027, then a check-in every year after.')
  })
  it('handles one inspection, other cadences, never, and year wrap', () => {
    expect(checkupExample({ inspectionMonths: [6], touchEveryMonths: 24 }, '2026-12-31')).toBe('Example: a job finished today gets an inspection in Jun 2027, then a check-in every 2 years after.')
    expect(checkupExample({ inspectionMonths: [3, 6, 12], touchEveryMonths: 0 }, '2026-11-12')).toBe('Example: a job finished today gets inspections in Feb 2027, May 2027 and Nov 2027, and no check-ins after that.')
    expect(checkupExample({ inspectionMonths: [12], touchEveryMonths: 18 }, '2026-01-31')).toContain('then a check-in every 18 months after')
    expect(checkupExample({ inspectionMonths: [], touchEveryMonths: 12 }, '2026-11-12')).toMatch(/at least one inspection/)
  })
  it('month-end clamps (Aug 31 + 6 months → Feb), leap years too, and uses the company word for a job', () => {
    expect(checkupExample({ inspectionMonths: [6], touchEveryMonths: 0 }, '2026-08-31')).toContain('in Feb 2027')
    expect(checkupExample({ inspectionMonths: [6], touchEveryMonths: 0 }, '2027-08-31')).toContain('in Feb 2028')
    expect(checkupExample({ inspectionMonths: [1], touchEveryMonths: 0 }, '2027-01-31')).toContain('in Feb 2027')
    expect(checkupExample({ inspectionMonths: [6], touchEveryMonths: 12 }, '2026-11-12', 'Project')).toMatch(/^Example: a project finished today/)
  })
})

describe('chip limits come from the settings module', () => {
  it('matches parseInspectionMonths and the signing reminder rules', () => {
    expect(INSPECTION_CHIP_RULES).toEqual({ unit: 'month', min: 1, max: 120, maxCount: 4 })
    expect(parseInspectionMonths([1, 2, 3, 4, 5])).toBeNull()
  })
})
