/**
 * Plain-words view of the checkup settings for the Settings card (client-safe, no storage of its own).
 * The stored shape and the limits stay in lib/checkups-settings.ts; this only maps them to chips, a select and one example line.
 */
import { INSPECTION_MONTH_RANGE, MAX_INSPECTIONS, addMonthsYmd } from '@/lib/checkups-settings'
import type { ChipRules } from '@/lib/chip-numbers'

/** Months offered by "+ Add inspection" (a typed number is also allowed). */
export const INSPECTION_PRESET_MONTHS: readonly number[] = [3, 6, 9, 12, 18, 24]
/** Same limits parseInspectionMonths enforces: 1-4 different whole months, 1-120. */
export const INSPECTION_CHIP_RULES: ChipRules = { unit: 'month', min: INSPECTION_MONTH_RANGE.min, max: INSPECTION_MONTH_RANGE.max, maxCount: MAX_INSPECTIONS }

export const TOUCH_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: 'Never' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Every year' },
  { value: 24, label: 'Every 2 years' },
]

/** Plain wording for any stored value: the four choices, else "Every N months" so nothing is lost. */
export function touchLabel(value: number): string {
  const known = TOUCH_CHOICES.find((c) => c.value === value)
  if (known) return known.label
  return value === 1 ? 'Every month' : `Every ${value} months`
}

/** The select's options for a value: the four choices, plus the stored value when it is something else. */
export function touchOptions(current: number): Array<{ value: number; label: string }> {
  const list = TOUCH_CHOICES.map((c) => ({ ...c }))
  if (!list.some((c) => c.value === current)) list.push({ value: current, label: touchLabel(current) })
  return list
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2027-05-12" → "May 2027". */
export function monthYearOfYmd(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

function joinPlain(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function everyPhrase(n: number): string {
  if (n === 12) return 'every year'
  if (n === 24) return 'every 2 years'
  return n === 1 ? 'every month' : `every ${n} months`
}

/** One line showing what the current choices do for a job finished on `todayYmd` (the company's today, passed in). `jobWord` is the company's own word for a job (industry profile term). */
export function checkupExample(s: { inspectionMonths: number[]; touchEveryMonths: number }, todayYmd: string, jobWord = 'job'): string {
  if (s.inspectionMonths.length === 0) return 'Add at least one inspection to see an example.'
  const dates = [...s.inspectionMonths].sort((a, b) => a - b).map((m) => monthYearOfYmd(addMonthsYmd(todayYmd, m)))
  const first = `Example: a ${jobWord.toLowerCase()} finished today gets ${s.inspectionMonths.length === 1 ? 'an inspection' : 'inspections'} in ${joinPlain(dates)}`
  return s.touchEveryMonths > 0 ? `${first}, then a check-in ${everyPhrase(s.touchEveryMonths)} after.` : `${first}, and no check-ins after that.`
}
