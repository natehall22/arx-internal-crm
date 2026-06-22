import { starterFromLinearFt } from '@/lib/starter-strip'
import { roofStarterBundlesFromLf } from '@/lib/roof-material-order'
import { STARTER_LF_PER_BUNDLE } from '@/lib/roof-shingle-constants'

describe('starter strip order (IKO Leading Edge Plus, 123.4 LF/bundle)', () => {
  it('sums eaves + rakes and ceils to whole bundles', () => {
    // 100 + 88 = 188 LF → 188 / 123.4 = 1.52 → 2 bundles
    const s = starterFromLinearFt({ eaves_lf: 100, rakes_lf: 88 })
    expect(s).not.toBeNull()
    expect(s!.combinedLf).toBe(188)
    expect(s!.bundles).toBe(2)
    expect(s!.lfPerBundle).toBe(STARTER_LF_PER_BUNDLE)
  })

  it('returns null when there is no eave or rake LF', () => {
    expect(starterFromLinearFt({ eaves_lf: 0, rakes_lf: 0 })).toBeNull()
    expect(starterFromLinearFt({ eaves_lf: null, rakes_lf: null })).toBeNull()
  })

  it('ignores negative / non-finite values', () => {
    const s = starterFromLinearFt({ eaves_lf: -50, rakes_lf: 60 })
    expect(s!.combinedLf).toBe(60)
    expect(s!.eaves_lf).toBe(0)
    expect(s!.rakes_lf).toBe(60)
  })

  it('roofStarterBundlesFromLf matches the summary bundle count', () => {
    const o = roofStarterBundlesFromLf(140, 110)
    expect(o.combinedLf).toBe(250)
    expect(o.bundles).toBe(3) // 250 / 123.4 = 2.03 → 3
  })
})
