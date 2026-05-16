export type ExteriorMeasureOpening = {
  width_ft?: number | null
  height_ft?: number | null
  quantity?: number | null
}

export type ExteriorMeasureElevation = {
  wall_width_ft?: number | null
  wall_height_ft?: number | null
  gable_width_ft?: number | null
  gable_height_ft?: number | null
  waste_percent?: number | null
  soffit_depth_ft?: number | null
  soffit_length_ft?: number | null
  fascia_lf?: number | null
  gutter_lf?: number | null
  starter_strip_lf?: number | null
  j_channel_lf?: number | null
  inside_corners?: number | null
  outside_corners?: number | null
  openings?: ExteriorMeasureOpening[]
}

export type ExteriorMeasureTotals = {
  gross_wall_sqft: number
  gable_sqft: number
  opening_deductions_sqft: number
  net_siding_sqft: number
  waste_sqft: number
  siding_sqft_with_waste: number
  siding_squares: number
  soffit_sqft: number
  fascia_lf: number
  gutter_lf: number
  starter_strip_lf: number
  j_channel_lf: number
  inside_corners: number
  outside_corners: number
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function calculateElevationMeasure(elevation: ExteriorMeasureElevation): ExteriorMeasureTotals {
  const grossWall = num(elevation.wall_width_ft) * num(elevation.wall_height_ft)
  const gable = (num(elevation.gable_width_ft) * num(elevation.gable_height_ft)) / 2
  const openingDeductions = (elevation.openings || []).reduce(
    (sum, opening) => sum + num(opening.width_ft) * num(opening.height_ft) * Math.max(1, num(opening.quantity)),
    0
  )
  const netSiding = Math.max(0, grossWall + gable - openingDeductions)
  const wasteSqft = netSiding * (num(elevation.waste_percent) / 100)
  const sidingWithWaste = netSiding + wasteSqft
  const soffitLength = num(elevation.soffit_length_ft) || num(elevation.wall_width_ft)

  return {
    gross_wall_sqft: round(grossWall),
    gable_sqft: round(gable),
    opening_deductions_sqft: round(openingDeductions),
    net_siding_sqft: round(netSiding),
    waste_sqft: round(wasteSqft),
    siding_sqft_with_waste: round(sidingWithWaste),
    siding_squares: round(sidingWithWaste / 100, 2),
    soffit_sqft: round(num(elevation.soffit_depth_ft) * soffitLength),
    fascia_lf: round(num(elevation.fascia_lf)),
    gutter_lf: round(num(elevation.gutter_lf)),
    starter_strip_lf: round(num(elevation.starter_strip_lf)),
    j_channel_lf: round(num(elevation.j_channel_lf)),
    inside_corners: Math.round(num(elevation.inside_corners)),
    outside_corners: Math.round(num(elevation.outside_corners)),
  }
}

export function calculateExteriorMeasureTotals(elevations: ExteriorMeasureElevation[]): ExteriorMeasureTotals {
  const totals = elevations.reduce<ExteriorMeasureTotals>(
    (sum, elevation) => {
      const calc = calculateElevationMeasure(elevation)
      return {
        gross_wall_sqft: sum.gross_wall_sqft + calc.gross_wall_sqft,
        gable_sqft: sum.gable_sqft + calc.gable_sqft,
        opening_deductions_sqft: sum.opening_deductions_sqft + calc.opening_deductions_sqft,
        net_siding_sqft: sum.net_siding_sqft + calc.net_siding_sqft,
        waste_sqft: sum.waste_sqft + calc.waste_sqft,
        siding_sqft_with_waste: sum.siding_sqft_with_waste + calc.siding_sqft_with_waste,
        siding_squares: sum.siding_squares + calc.siding_squares,
        soffit_sqft: sum.soffit_sqft + calc.soffit_sqft,
        fascia_lf: sum.fascia_lf + calc.fascia_lf,
        gutter_lf: sum.gutter_lf + calc.gutter_lf,
        starter_strip_lf: sum.starter_strip_lf + calc.starter_strip_lf,
        j_channel_lf: sum.j_channel_lf + calc.j_channel_lf,
        inside_corners: sum.inside_corners + calc.inside_corners,
        outside_corners: sum.outside_corners + calc.outside_corners,
      }
    },
    {
      gross_wall_sqft: 0,
      gable_sqft: 0,
      opening_deductions_sqft: 0,
      net_siding_sqft: 0,
      waste_sqft: 0,
      siding_sqft_with_waste: 0,
      siding_squares: 0,
      soffit_sqft: 0,
      fascia_lf: 0,
      gutter_lf: 0,
      starter_strip_lf: 0,
      j_channel_lf: 0,
      inside_corners: 0,
      outside_corners: 0,
    }
  )

  return {
    gross_wall_sqft: round(totals.gross_wall_sqft),
    gable_sqft: round(totals.gable_sqft),
    opening_deductions_sqft: round(totals.opening_deductions_sqft),
    net_siding_sqft: round(totals.net_siding_sqft),
    waste_sqft: round(totals.waste_sqft),
    siding_sqft_with_waste: round(totals.siding_sqft_with_waste),
    siding_squares: round(totals.siding_sqft_with_waste / 100, 2),
    soffit_sqft: round(totals.soffit_sqft),
    fascia_lf: round(totals.fascia_lf),
    gutter_lf: round(totals.gutter_lf),
    starter_strip_lf: round(totals.starter_strip_lf),
    j_channel_lf: round(totals.j_channel_lf),
    inside_corners: Math.round(totals.inside_corners),
    outside_corners: Math.round(totals.outside_corners),
  }
}
