import { STARTER_LF_PER_BUNDLE } from '@/lib/roof-shingle-constants'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function positiveLf(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(Number(value))) return 0
  const n = Number(value)
  return n > 0 ? n : 0
}

export type StarterStripSummary = {
  /** Eave LF + rake LF from measure. */
  combinedLf: number
  /** Eave LF only (some shops run starter on eaves only). */
  eaves_lf: number
  /** Rake LF only. */
  rakes_lf: number
  /** Bundles to order at the configured coverage. */
  bundles: number
  lfPerBundle: number
}

/**
 * Starter material order from eave + rake linear feet.
 * Returns null when there is no eave or rake LF to summarize.
 */
export function starterFromLinearFt(input: {
  eaves_lf: number | null | undefined
  rakes_lf: number | null | undefined
  lfPerBundle?: number
  /** Extra LF cushion before bundle math (e.g. 5 = add 5%). Default 0. */
  cushionPercent?: number
}): StarterStripSummary | null {
  const lfPerBundle = input.lfPerBundle ?? STARTER_LF_PER_BUNDLE
  if (!(lfPerBundle > 0)) return null

  const eaves_lf = positiveLf(input.eaves_lf)
  const rakes_lf = positiveLf(input.rakes_lf)
  let combinedLf = round2(eaves_lf + rakes_lf)
  if (combinedLf <= 0) return null

  const cushionPercent = input.cushionPercent ?? 0
  if (cushionPercent > 0) {
    combinedLf = round2(combinedLf * (1 + cushionPercent / 100))
  }

  const bundles = Math.ceil(combinedLf / lfPerBundle)

  return { combinedLf, eaves_lf, rakes_lf, bundles, lfPerBundle }
}
