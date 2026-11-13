/** Whole-number chip lists for settings cards (client-safe): "6 months ×", "2 days ×". Limits come from the caller, which takes them from the settings module that enforces them. */
export type ChipUnit = 'month' | 'day'

export function unitLabel(n: number, unit: ChipUnit): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

export type ChipRules = { unit: ChipUnit; min: number; max: number; maxCount: number }

/** Adds `raw` (a number or typed digits) in ascending order, or says why not. */
export function addChipNumber(list: number[], raw: unknown, rules: ChipRules): { values: number[] } | { error: string } {
  const text = typeof raw === 'string' ? raw.trim() : raw
  const n = typeof text === 'number' ? text : typeof text === 'string' && /^\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isInteger(n) || n < rules.min || n > rules.max) return { error: `Type a whole number of ${rules.unit}s from ${rules.min} to ${rules.max}.` }
  if (list.includes(n)) return { error: `${unitLabel(n, rules.unit)} is already on the list.` }
  if (list.length >= rules.maxCount) return { error: `Up to ${rules.maxCount}.` }
  return { values: [...list, n].sort((a, b) => a - b) }
}

export function removeChipNumber(list: number[], n: number): number[] {
  return list.filter((x) => x !== n)
}
