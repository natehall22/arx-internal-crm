import {
  coveredAutoLf,
  DRAWN_LINE_COVER_TOLERANCE_M,
  mergeDrawnAndAutoLf,
} from '@/lib/roof-drawn-line-supersede'
import { classifyRoofEdges, type FacetInput } from '@/lib/roof-measure-edge-classification'

const BASE_LAT = 35.5
const BASE_LNG = -80.6
const FT_TO_LAT = 1 / 364000
const FT_TO_LNG = FT_TO_LAT / Math.cos((BASE_LAT * Math.PI) / 180)
const pt = (northFt: number, eastFt: number) => ({
  lat: BASE_LAT + northFt * FT_TO_LAT,
  lng: BASE_LNG + eastFt * FT_TO_LNG,
})
const rect = (id: string, west: number, south: number, east: number, north: number): FacetInput => ({
  id,
  points: [pt(south, west), pt(south, east), pt(north, east), pt(north, west)],
})

// Four equal quadrants around a shared centre: every interior edge is a hip.
const hipRoof = [
  rect('nw', -60, 0, 0, 60),
  rect('ne', 0, 0, 60, 60),
  rect('se', 0, -60, 60, 0),
  rect('sw', -60, -60, 0, 0),
]
const noSlope = new Map<string, number>()

function totalAuto() {
  return classifyRoofEdges(hipRoof)
}

describe('coveredAutoLf', () => {
  it('records edge endpoints on classified edges', () => {
    for (const e of totalAuto().classifiedEdges) {
      expect(e.p1).toBeDefined()
      expect(e.p2).toBeDefined()
    }
  })

  it('a drawn line lying on an auto convex edge covers that edge, whatever type it was drawn as', () => {
    const result = totalAuto()
    expect(result.hips_lf).toBeGreaterThan(0)
    for (const type of ['ridge', 'hip']) {
      const covered = coveredAutoLf({
        result,
        lines: [{ type, points: [pt(0, -60), pt(0, 0)] }],
        mults: noSlope,
      })
      // The line runs the full 60 ft of the west half of the E-W seam; its end may also reach
      // up to one tolerance (~3.3 ft) into the collinear east half.
      const tolFt = DRAWN_LINE_COVER_TOLERANCE_M * 3.281
      expect(covered.hips_lf + covered.ridges_lf).toBeGreaterThanOrEqual(58)
      expect(covered.hips_lf + covered.ridges_lf).toBeLessThanOrEqual(60 + Math.ceil(tolFt) + 1)
    }
  })

  it('does not cover an edge the line only crosses', () => {
    const covered = coveredAutoLf({
      result: totalAuto(),
      // Vertical line through the middle of the W half of the E-W seam, far from any N-S seam.
      lines: [{ type: 'ridge', points: [pt(-20, -30), pt(20, -30)] }],
      mults: noSlope,
    })
    expect(covered.hips_lf + covered.ridges_lf).toBe(0)
  })

  it('does not cover an edge that is far away', () => {
    const covered = coveredAutoLf({
      result: totalAuto(),
      lines: [{ type: 'ridge', points: [pt(200, -60), pt(200, 0)] }],
      mults: noSlope,
    })
    expect(covered).toEqual({ ridges_lf: 0, hips_lf: 0, valleys_lf: 0 })
  })

  it('a valley line never supersedes convex edges, and a ridge line never supersedes valleys', () => {
    const result = totalAuto()
    const valleyOverHip = coveredAutoLf({
      result,
      lines: [{ type: 'valley', points: [pt(0, -60), pt(0, 0)] }],
      mults: noSlope,
    })
    expect(valleyOverHip.hips_lf + valleyOverHip.ridges_lf).toBe(0)

    const lShape = classifyRoofEdges([
      { ...rect('west', -40, -40, 0, 40), pitch_degrees: 22 },
      { ...rect('east', 0, -40, 40, 40), pitch_degrees: 22 },
    ])
    const ridgeOverAnything = coveredAutoLf({
      result: lShape,
      lines: [{ type: 'ridge', points: [pt(-40, 0), pt(40, 0)] }],
      mults: noSlope,
    })
    expect(ridgeOverAnything.valleys_lf).toBe(0)
  })

  it('two lines over the same edge do not cover it twice', () => {
    const result = totalAuto()
    const once = coveredAutoLf({
      result,
      lines: [{ type: 'ridge', points: [pt(0, -60), pt(0, 0)] }],
      mults: noSlope,
    })
    const twice = coveredAutoLf({
      result,
      lines: [
        { type: 'ridge', points: [pt(0, -60), pt(0, 0)] },
        { type: 'hip', points: [pt(0, -60), pt(0, 0)] },
      ],
      mults: noSlope,
    })
    expect(twice).toEqual(once)
  })

  it('ignores flashing/custom lines and edges without coordinates', () => {
    const result = totalAuto()
    expect(
      coveredAutoLf({
        result,
        lines: [{ type: 'step_flashing', points: [pt(0, -60), pt(0, 0)] }],
        mults: noSlope,
      })
    ).toEqual({ ridges_lf: 0, hips_lf: 0, valleys_lf: 0 })

    const stripped = {
      ...result,
      classifiedEdges: result.classifiedEdges.map(({ p1: _p1, p2: _p2, ...rest }) => rest),
    }
    expect(
      coveredAutoLf({
        result: stripped,
        lines: [{ type: 'ridge', points: [pt(0, -60), pt(0, 0)] }],
        mults: noSlope,
      })
    ).toEqual({ ridges_lf: 0, hips_lf: 0, valleys_lf: 0 })
  })

  it('slope-corrects covered hips the same way the auto totals are', () => {
    const result = totalAuto()
    const mults = new Map(result.classifiedEdges.flatMap((e) => [[e.facetIdA, 1.2] as const]))
    const flat = coveredAutoLf({
      result,
      lines: [{ type: 'ridge', points: [pt(0, -60), pt(0, 0)] }],
      mults: noSlope,
    })
    const steep = coveredAutoLf({
      result,
      lines: [{ type: 'ridge', points: [pt(0, -60), pt(0, 0)] }],
      mults,
    })
    expect(steep.hips_lf).toBeGreaterThan(flat.hips_lf)
  })
})

describe('mergeDrawnAndAutoLf', () => {
  const none = { ridges_lf: 0, hips_lf: 0, valleys_lf: 0 }

  it('changes nothing when nothing is drawn', () => {
    const auto = { ridges_lf: 47, hips_lf: 296, valleys_lf: 174 }
    expect(mergeDrawnAndAutoLf({ auto, covered: none, drawn: none })).toEqual(auto)
  })

  it('Corriher Springs: drawn ridges over auto hips no longer double the cap LF', () => {
    // Values replayed from the saved measurement: the tool reported 301 / 296 / 407.
    const merged = mergeDrawnAndAutoLf({
      auto: { ridges_lf: 47, hips_lf: 296, valleys_lf: 174 },
      covered: { ridges_lf: 6, hips_lf: 247, valleys_lf: 123 },
      drawn: { ridges_lf: 301, hips_lf: 0, valleys_lf: 233 },
    })
    expect(merged).toEqual({ ridges_lf: 301, hips_lf: 49, valleys_lf: 284 })
    // Carrier report: ridge + hip cap = 326 LF. Was 597.
    expect(merged.ridges_lf + merged.hips_lf).toBe(350)
  })

  it('drawn ridge lines stay the full ridge set; auto ridge only survives when none are drawn', () => {
    expect(
      mergeDrawnAndAutoLf({
        auto: { ridges_lf: 40, hips_lf: 0, valleys_lf: 0 },
        covered: { ridges_lf: 10, hips_lf: 0, valleys_lf: 0 },
        drawn: { ridges_lf: 25, hips_lf: 0, valleys_lf: 0 },
      }).ridges_lf
    ).toBe(25)
    expect(
      mergeDrawnAndAutoLf({
        auto: { ridges_lf: 40, hips_lf: 0, valleys_lf: 0 },
        covered: none,
        drawn: none,
      }).ridges_lf
    ).toBe(40)
  })

  it('a drawn hip replaces the auto ridge edge it lies on, and adds its own length as hip', () => {
    expect(
      mergeDrawnAndAutoLf({
        auto: { ridges_lf: 40, hips_lf: 30, valleys_lf: 0 },
        covered: { ridges_lf: 40, hips_lf: 0, valleys_lf: 0 },
        drawn: { ridges_lf: 0, hips_lf: 44, valleys_lf: 0 },
      })
    ).toEqual({ ridges_lf: 0, hips_lf: 74, valleys_lf: 0 })
  })

  it('a partly drawn roof keeps the auto edges no line lies on', () => {
    expect(
      mergeDrawnAndAutoLf({
        auto: { ridges_lf: 0, hips_lf: 100, valleys_lf: 90 },
        covered: { ridges_lf: 0, hips_lf: 30, valleys_lf: 40 },
        drawn: { ridges_lf: 0, hips_lf: 32, valleys_lf: 41 },
      })
    ).toEqual({ ridges_lf: 0, hips_lf: 102, valleys_lf: 91 })
  })

  it('never goes negative when the covered LF exceeds the (possibly overridden) auto total', () => {
    expect(
      mergeDrawnAndAutoLf({
        auto: { ridges_lf: 0, hips_lf: 10, valleys_lf: 5 },
        covered: { ridges_lf: 8, hips_lf: 40, valleys_lf: 30 },
        drawn: none,
      })
    ).toEqual({ ridges_lf: 0, hips_lf: 0, valleys_lf: 0 })
  })
})
