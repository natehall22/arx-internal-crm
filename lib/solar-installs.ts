/**
 * Pure shaping logic for solar-install rows → canvass overlay features.
 *
 * Kept out of the route handler so it can be tested without a web runtime, and
 * so the HTTP layer stays thin (auth, bbox, cache, response).
 */

import type { InstallerStatus } from '@/lib/solar-installers'
import type { SolarFeature } from '@/app/(canvass-app)/canvass/lib/solar-overlay'

/** A `solar_installs` row with its installer embedded, as selected by the route. */
export type InstallRow = {
  pin: string | null
  address: string | null
  lat: number | null
  lng: number | null
  issued_on: string | null
  installer_name_raw: string | null
  owner_is_original: boolean | null
  solar_installers: { status: string | null; display_name: string | null } | null
}

/**
 * Anything we did not positively confirm is 'unknown'. Never infer 'defunct'
 * from a missing join — claiming a live company is out of business is both false
 * and a UDTPA exposure.
 */
export function toStatus(raw: string | null | undefined): InstallerStatus {
  return raw === 'defunct' || raw === 'active' ? raw : 'unknown'
}

/**
 * One physical install often carries several permits (building + electrical +
 * zoning), and we keep every permit row at ingest. Collapse them per property,
 * keeping the EARLIEST issue date — that's when the array actually went up — and
 * preferring whichever row managed to resolve an installer.
 */
export function dedupeByProperty(rows: InstallRow[]): InstallRow[] {
  const byProperty = new Map<string, InstallRow>()
  for (const row of rows) {
    if (row.lat == null || row.lng == null) continue
    const key = row.pin?.trim() || row.address?.trim().toLowerCase()
    if (!key) continue

    const existing = byProperty.get(key)
    if (!existing) {
      byProperty.set(key, row)
      continue
    }

    const existingResolved = Boolean(existing.solar_installers)
    const candidateResolved = Boolean(row.solar_installers)
    // A row that identified the installer beats one that didn't.
    if (candidateResolved && !existingResolved) {
      byProperty.set(key, row)
      continue
    }
    if (existingResolved && !candidateResolved) continue

    // Otherwise the earliest permit wins — later ones are usually re-inspections.
    // A null date sorts last so it never masquerades as the original install.
    if ((row.issued_on ?? '9999') < (existing.issued_on ?? '9999')) {
      byProperty.set(key, row)
    }
  }
  return Array.from(byProperty.values())
}

/** Earliest plausible residential PV permit year — anything older is a data error. */
const MIN_INSTALL_YEAR = 1990

export function toFeature(row: InstallRow, currentYear: number): SolarFeature | null {
  if (row.lat == null || row.lng == null) return null

  const parsed = row.issued_on ? Number(row.issued_on.slice(0, 4)) : NaN
  const installedYear =
    Number.isFinite(parsed) && parsed >= MIN_INSTALL_YEAR && parsed <= currentYear
      ? parsed
      : undefined

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [row.lng, row.lat] },
    properties: {
      installedYear,
      systemAge: installedYear ? currentYear - installedYear : undefined,
      installerStatus: toStatus(row.solar_installers?.status),
      // Only the resolved registry name is exposed. The raw permit string stays
      // server-side: showing an unmatched string would imply we know who they
      // are and, worse, that we know their status.
      installerName: row.solar_installers?.display_name ?? null,
      ownerIsOriginal: row.owner_is_original,
    },
  }
}
