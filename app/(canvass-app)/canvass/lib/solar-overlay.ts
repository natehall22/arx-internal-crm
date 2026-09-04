/**
 * Solar overlay: homes with a permitted solar array, colored by whether the
 * company that installed it is still in business.
 *
 * Every solar home is a roofing lead — a roof under an array will need replacing
 * inside the array's life, and the detach-and-reset makes it a bigger job than a
 * bare roof. But an ORPHANED system, where the installer is gone, is the lead
 * worth knocking first: nobody is coming to service it, and the homeowner
 * usually doesn't know that yet.
 *
 * Age is stored and shown, but is deliberately NOT what colors a dot. Installer
 * status is the signal.
 */

import type { InstallerStatus } from '@/lib/solar-installers'

export type SolarFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] } | null
  properties: {
    /** Permit-issue year — shown as system age in copy, never as the bucket. */
    installedYear?: number
    systemAge?: number
    installerStatus: InstallerStatus
    installerName?: string | null
    /** True when the permit-era owner still owns the home. */
    ownerIsOriginal?: boolean | null
  }
}

/** Why a successful fetch returned no markers. */
export type SolarEmptyReason = 'no_permits_loaded' | 'none_in_view'

export type SolarFeatureCollection = {
  type: 'FeatureCollection'
  features: SolarFeature[]
  degraded?: boolean
  emptyReason?: SolarEmptyReason
}

/** Street zoom only — same gate as the roof-age layer. */
export const MIN_SOLAR_ZOOM = 16

type SolarBucket = {
  status: InstallerStatus
  fill: string
  label: string
}

/**
 * Luminance-ordered like every other canvass layer, so "darker/hotter = better
 * lead" holds across overlays. Orphaned is the only one that gets the alarm
 * color, because it is the only one we can make a claim about.
 */
export const SOLAR_LEGEND: SolarBucket[] = [
  { status: 'defunct', fill: '#B91C1C', label: 'Installer out of business' },
  { status: 'unknown', fill: '#F59E0B', label: 'Installer unconfirmed' },
  { status: 'active', fill: '#64748B', label: 'Installer still active' },
]

export function solarBucket(status: InstallerStatus): SolarBucket {
  return SOLAR_LEGEND.find((b) => b.status === status) ?? SOLAR_LEGEND[2]
}

/**
 * Ground radius in meters. google.maps.Circle rather than a Data-layer symbol —
 * iOS Safari does not paint SVG point symbols on the Data layer (field-verified
 * Jul 2026, same fix as roof-age and storm dots).
 *
 * Orphaned dots run slightly larger so they read first in a dense block.
 */
export function solarMarkerRadiusMeters(status: InstallerStatus): number {
  return status === 'defunct' ? 10 : 8
}

/** White ring for contrast against satellite imagery. */
export const SOLAR_MARKER_STROKE = {
  strokeColor: '#FFFFFF',
  strokeOpacity: 1,
  strokeWeight: 2,
} as const

/** Above roof-age (2) and storm dots (3) — solar is the more specific signal. */
export const SOLAR_MARKER_Z_INDEX = 4

/**
 * Field-facing marker label. Plain "what goes where" only — reps get the fact,
 * not the reasoning behind it.
 */
export function solarMarkerLabel(props: SolarFeature['properties']): string {
  const parts: string[] = []
  if (props.systemAge != null) parts.push(`Solar, ${props.systemAge} yrs (est.)`)
  else parts.push('Solar')
  if (props.installerStatus === 'defunct') {
    parts.push(props.installerName ? `${props.installerName} — closed` : 'Installer closed')
  } else if (props.installerName) {
    parts.push(props.installerName)
  }
  return parts.join(' · ')
}

const SOLAR_STORAGE_KEY = 'canvass-solar-on'

export function readStoredSolarOn(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SOLAR_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function storeSolarOn(on: boolean) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOLAR_STORAGE_KEY, on ? 'true' : 'false')
  } catch {
    // private-mode Safari throws on setItem — selection just won't persist
  }
}
