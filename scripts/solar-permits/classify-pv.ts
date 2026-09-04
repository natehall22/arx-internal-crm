/**
 * Conservative PV classification for permit text.
 *
 * Used to stop counting every Mecklenburg "Skylight/Solar Panel" work-type
 * as a rooftop array. Ambiguous rows are kept, not deleted.
 */

export const PV_CLASSES = ['CONFIRMED_PV', 'LIKELY_PV', 'AMBIGUOUS_SOLAR', 'NON_PV'] as const
export type PvClass = (typeof PV_CLASSES)[number]

const RANK: Record<PvClass, number> = {
  CONFIRMED_PV: 3,
  LIKELY_PV: 2,
  AMBIGUOUS_SOLAR: 1,
  NON_PV: 0,
}

export function strongerPvClass(a: PvClass, b: PvClass): PvClass {
  return RANK[a] >= RANK[b] ? a : b
}

function haystack(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(' | ')
}

const NON_PV_PATTERNS: Array<[RegExp, string]> = [
  [/solar[ -]?ready/i, 'solar-ready'],
  [/solar\s+attic/i, 'solar attic fan'],
  [/solar[ -]?powered\s+(fan|light|lamp|vent)/i, 'solar-powered accessory'],
  [/solar\s+(light|lamp|fan|ventilation)/i, 'solar accessory'],
  [/solar\s+(water\s+heater|thermal|hot\s+water|pool)/i, 'solar thermal'],
  [/solatube|solar\s+tube|sun\s+tunnel/i, 'tubular skylight'],
  [/solar\s+farm/i, 'utility-scale solar farm'],
]

const CONFIRMED_PATTERNS: Array<[RegExp, string]> = [
  [/photovoltaic/i, 'photovoltaic'],
  [/\bsolar\s*pv\b/i, 'solar PV'],
  [/\bpv\s*(system|array|install|module|solar)/i, 'PV system'],
  [/res[ -]?solar/i, 'RES-SOLAR'],
  [/\bsolarpv\b/i, 'SolarPV'],
  [/\d+(\.\d+)?\s*k\s*w\b/i, 'kW capacity'],
  [/\binverter/i, 'inverter'],
  [/solar\s+array/i, 'solar array'],
  [/roof[ -]?mounted\s+solar/i, 'roof-mounted solar'],
  [/ground[ -]?mount(ed)?\s+solar/i, 'ground-mount solar'],
  [/rooftop\s+(pv|solar)/i, 'rooftop PV'],
  [/\d+\s*(solar\s+)?(modules?|panels?)/i, 'module/panel count'],
]

const LIKELY_PATTERNS: Array<[RegExp, string]> = [
  [/residential\s+solar/i, 'residential solar'],
  [/install(ation)?\s+of\s+.{0,40}solar/i, 'installation of solar'],
  [/\bsolar\s+panels?\b/i, 'solar panel(s)'],
  [/\bsolar\s+panel\s+system\b/i, 'solar panel system'],
]

const GENERIC_SOLAR = /\bsolar\b|\bpv\b|photovoltaic/i
const SKYLIGHT_BOILERPLATE = /skylight\s*\/\s*solar\s+panel/i

export type PvClassification = {
  pvClass: PvClass
  evidence: string[]
}

export function classifyPvText(parts: Array<string | null | undefined>): PvClassification {
  const text = haystack(parts)
  if (!text.trim()) return { pvClass: 'NON_PV', evidence: ['empty'] }

  const evidence: string[] = []

  for (const [re, label] of NON_PV_PATTERNS) {
    if (re.test(text)) evidence.push(label)
  }
  if (evidence.length > 0) {
    // A solar-farm / thermal / solar-ready hit beats rooftop PV claims on the same row.
    return { pvClass: 'NON_PV', evidence }
  }

  for (const [re, label] of CONFIRMED_PATTERNS) {
    if (re.test(text)) evidence.push(label)
  }
  if (evidence.length > 0) return { pvClass: 'CONFIRMED_PV', evidence }

  const skylightOnly = SKYLIGHT_BOILERPLATE.test(text)
  const withoutBoilerplate = text.replace(/skylight\s*\/\s*solar\s+panel/gi, ' ')

  for (const [re, label] of LIKELY_PATTERNS) {
    if (re.test(withoutBoilerplate)) evidence.push(label)
  }
  if (evidence.length > 0) return { pvClass: 'LIKELY_PV', evidence }

  if (skylightOnly || GENERIC_SOLAR.test(text)) {
    return {
      pvClass: 'AMBIGUOUS_SOLAR',
      evidence: skylightOnly ? ['Skylight/Solar Panel boilerplate'] : ['generic solar mention'],
    }
  }

  return { pvClass: 'NON_PV', evidence: ['no solar language'] }
}

export function classifyPermitRecord(record: {
  description?: string | null
  permitType?: string | null
  permitSubtype?: string | null
  permitNumber?: string | null
}): PvClassification {
  return classifyPvText([
    record.description,
    record.permitType,
    record.permitSubtype,
    record.permitNumber,
  ])
}
