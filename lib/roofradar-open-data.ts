const DAY_MS = 86400000

const IEM_LSR_URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson'

// Thunderstorm wind (LSR types G/D) is always relevant. Non-thunderstorm wind
// (types N/O) is only shown when EXTREME — a measured gust at/above the NWS
// damaging-wind threshold (58 mph / 50 kt), or a confirmed wind-damage report.
// This keeps ordinary breezes off the canvass map while still surfacing roof-
// damaging straight-line/gradient wind events. Tune this one number to taste.
const EXTREME_NON_TSTM_WIND_MPH = 58

function isoMinuteZ(d: Date) {
  return d.toISOString().slice(0, 16) + 'Z'
}

export type RecentStormReport = {
  lat: number
  lng: number
  /** inches for hail, mph for wind gusts, 0 for wind-damage reports with no measured gust */
  magnitude: number
  date: Date
  /** true for a wind-damage report (no measured gust speed) */
  damage: boolean
}

/**
 * Recent local storm reports (last `windowDays`) within a bbox, from the free
 * IEM (Iowa Environmental Mesonet) Local Storm Report feed. Unlike the SPC WCM
 * annual archive (which lags ~1 year), LSRs are near-real-time — the right
 * source for "what hit this neighborhood recently".
 *   hail  -> type 'H' (magf = inches)
 *   wind  -> type 'G' (TSTM gust, magf = mph) and 'D' (TSTM wind damage, no speed),
 *            plus EXTREME non-thunderstorm wind: 'N' (non-TSTM gust) only when
 *            magf >= EXTREME_NON_TSTM_WIND_MPH, and 'O' (non-TSTM wind damage).
 */
export async function getRecentStormReportsInBbox(
  bbox: { n: number; s: number; e: number; w: number },
  type: 'hail' | 'wind',
  windowDays: number,
): Promise<RecentStormReport[]> {
  const ets = new Date()
  const sts = new Date(ets.getTime() - Math.max(1, windowDays) * DAY_MS)
  const params = new URLSearchParams({
    sts: isoMinuteZ(sts),
    ets: isoMinuteZ(ets),
    west: String(bbox.w),
    east: String(bbox.e),
    south: String(bbox.s),
    north: String(bbox.n),
  })

  try {
    const res = await fetch(`${IEM_LSR_URL}?${params.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => null)
    const features: unknown[] = Array.isArray((data as { features?: unknown[] })?.features)
      ? (data as { features: unknown[] }).features
      : []

    const out: RecentStormReport[] = []
    for (const raw of features) {
      const f = raw as {
        properties?: Record<string, unknown>
        geometry?: { type?: string; coordinates?: unknown }
      }
      const code = String(f.properties?.type || '')
      const magRaw = f.properties?.magf == null ? Number.NaN : Number(f.properties.magf)
      const magnitude = Number.isFinite(magRaw) ? magRaw : 0
      // IEM ships a sibling `unit`; wind gust magf is normally "MPH" (verified across
      // 3,386 live G/N reports on 2026-06-29: 100% MPH). Because the unit now GATES
      // inclusion for non-TSTM gusts (not just display), treat a present non-MPH unit
      // as untrusted speed so a knots value can't mis-fire the extreme-wind gate.
      const unit = String(f.properties?.unit || '').toUpperCase()
      const speedTrustedMph = unit === '' || unit === 'MPH'

      const isHail = code === 'H'
      // Thunderstorm wind (G gust / D damage): always relevant, any magnitude.
      // Non-thunderstorm wind only when extreme: N gust >= threshold (mph), or O damage.
      const isTstmWind = code === 'G' || code === 'D'
      const isExtremeNonTstmWind =
        code === 'O' ||
        (code === 'N' && speedTrustedMph && magnitude >= EXTREME_NON_TSTM_WIND_MPH)
      const isWind = isTstmWind || isExtremeNonTstmWind
      if (type === 'hail' && !isHail) continue
      if (type === 'wind' && !isWind) continue

      const coords =
        f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
          ? (f.geometry.coordinates as number[])
          : null
      if (!coords) continue
      const lng = Number(coords[0])
      const lat = Number(coords[1])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

      const when = new Date(String(f.properties?.valid || ''))
      if (Number.isNaN(when.getTime())) continue

      // D (TSTM) and O (non-TSTM) are damage reports with no measured gust.
      const damage = type === 'wind' && (code === 'D' || code === 'O')

      out.push({ lat, lng, magnitude, date: when, damage })
    }
    return out
  } catch {
    return []
  }
}
