import {
  excludeDispositionFilter,
  findSolarHomeDispositionId,
  matchesCanvassDispositionFilter,
  parseExcludedDisposition,
} from '@/lib/canvass-pin-filter'

const SOLAR = 'dispo_1790799669778'

describe('canvass pin disposition filter', () => {
  it('shows every pin with no filter', () => {
    expect(matchesCanvassDispositionFilter({ disposition: SOLAR }, null)).toBe(true)
    expect(matchesCanvassDispositionFilter({ d: 'not_home' }, '')).toBe(true)
  })

  it('include filter keeps only that disposition', () => {
    expect(matchesCanvassDispositionFilter({ disposition: 'hot_lead' }, 'hot_lead')).toBe(true)
    expect(matchesCanvassDispositionFilter({ disposition: SOLAR }, 'hot_lead')).toBe(false)
  })

  it('exclude filter hides only that disposition and keeps undispositioned + scheduled pins', () => {
    const hide = excludeDispositionFilter(SOLAR)
    expect(matchesCanvassDispositionFilter({ disposition: SOLAR }, hide)).toBe(false)
    expect(matchesCanvassDispositionFilter({ d: SOLAR }, hide)).toBe(false)
    expect(matchesCanvassDispositionFilter({ disposition: 'hot_lead' }, hide)).toBe(true)
    expect(matchesCanvassDispositionFilter({ disposition: null }, hide)).toBe(true)
    expect(matchesCanvassDispositionFilter({ s: 'inspection', d: 'inspection_scheduled' }, hide)).toBe(true)
  })

  it('rejects exclude ids that could inject into the PostgREST filter, and then hides nothing', () => {
    for (const bad of ['!a,status.eq.x', '!', '!DROP', '!a.b', `!${'x'.repeat(65)}`]) {
      expect(parseExcludedDisposition(bad)).toBeNull()
      expect(matchesCanvassDispositionFilter({ disposition: 'a' }, bad)).toBe(true)
    }
    expect(parseExcludedDisposition(excludeDispositionFilter(SOLAR))).toBe(SOLAR)
    expect(parseExcludedDisposition('hot_lead')).toBeNull()
  })

  it('finds the Solar Home disposition by label, ignoring inactive ones', () => {
    expect(
      findSolarHomeDispositionId([
        { id: 'dispo_1', label: 'Realestate' },
        { id: SOLAR, label: 'Solar Home' },
      ])
    ).toBe(SOLAR)
    expect(findSolarHomeDispositionId([{ id: SOLAR, label: 'Solar Home', active: false }])).toBeNull()
    expect(findSolarHomeDispositionId([{ id: 'x', label: 'Insolar' }])).toBeNull()
    expect(findSolarHomeDispositionId([])).toBeNull()
  })
})
