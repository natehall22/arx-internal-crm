/**
 * Fill year-built (roof proxy) and re-check PV classification.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/enrich-roof-age.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/solar-permits/enrich-roof-age.ts --commit
 *
 * Two enrichments, both from sources we already use — no new vendor, no request:
 *
 * 1. YEAR BUILT → roof age at install. The leak signal isn't system age or house
 *    age, it's how old the roof was when the panels went through it.
 *      mecklenburg  TaxParcel_camadata, joined on pid (yearbuilt + effyearblt)
 *      cabarrus     canvass_parcel_years, already loaded for the roof-age layer
 *      rowan        no keyed source found yet — stays null, reported honestly
 *
 * 2. PERMIT DESCRIPTION → PV re-classification. Mecklenburg concatenates
 *    "REPAIR/REPLACE. EXTERIOR ROOF ADDITION(S)" boilerplate onto permitdesc, and
 *    the original classifier demanded a literal PV/photovoltaic token. That
 *    pushed obviously-real installs ("ROOFTOP SOLAR", "SOLAR PANEL INSTALLATION")
 *    into AMBIGUOUS. We store the description so this stays auditable.
 *
 * A parcel can carry several buildings. We take the OLDEST yearbuilt on the
 * parcel: the array sits on the house, and taking the newest would let a 2021
 * detached garage hide a 1979 roof.
 */

import { createClient } from '@supabase/supabase-js'
import { fetchAllArcGISFeatures } from './arcgis'
import { MECKLENBURG_BUILDING_PERMITS_URL, MECKLENBURG_LEGACY_SOLAR_WHERE } from './collectors/mecklenburg'
import {
  CABARRUS_ARCGIS_BASE,
  CABARRUS_HISTORICAL_PERMIT_LAYERS,
  CABARRUS_SOLAR_WHERE,
  CABARRUS_YEAR_LAYERS,
} from './collectors/cabarrus'

const COMMIT = process.argv.includes('--commit')

const MECK_CAMA_URL =
  'https://meckgis.mecklenburgcountync.gov/server/rest/services/TaxParcel_camadata/MapServer/0'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CURRENT_YEAR = new Date().getFullYear()

/** Plausible construction years. Anything outside is a data error, not a house. */
function validYear(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n >= 1800 && n <= CURRENT_YEAR ? n : null
}

/** PostgREST caps a plain select at 1000 rows — always page. */
async function pagedSelect<T>(
  table: string,
  columns: string,
  filter?: (q: any) => any,
  // Not every reference table has an `id` — canvass_parcel_years is keyed (county, pin).
  orderBy = 'id',
): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).order(orderBy, { ascending: true }).range(from, from + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) {
      console.error(`read ${table} failed: ${error.message}`)
      process.exit(1)
    }
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/**
 * Evidence-based PV classification from a permit description.
 * Order matters: exclusions run before inclusions so "solar water heater" and
 * "solar ready" can never be promoted by the word "solar" alone.
 */
export function classifyPv(desc: string | null | undefined): {
  pvClass: 'CONFIRMED_PV' | 'LIKELY_PV' | 'AMBIGUOUS_SOLAR' | 'NON_PV'
  evidence: string
} {
  const d = String(desc ?? '').toUpperCase()
  if (!d.trim()) return { pvClass: 'AMBIGUOUS_SOLAR', evidence: 'no description' }

  // Not a rooftop array, whatever else the text says.
  if (/SOLAR\s*(HOT\s*)?WATER|SOLAR\s*THERMAL|WATER\s*HEATER/.test(d))
    return { pvClass: 'NON_PV', evidence: 'solar thermal / water heating' }
  if (/SOLAR[\s-]*READY|READY\s*FOR\s*SOLAR/.test(d))
    return { pvClass: 'NON_PV', evidence: 'solar-ready only, no array' }
  if (/SOLAR\s*(FARM|FIELD)|UTILITY\s*SCALE/.test(d))
    return { pvClass: 'NON_PV', evidence: 'utility-scale / solar farm' }

  // Unambiguous PV language.
  if (/PHOTOVOLTAIC|\bPV\b/.test(d)) return { pvClass: 'CONFIRMED_PV', evidence: 'explicit PV / photovoltaic' }
  if (/SOLAR\s*(PANEL|ARRAY|SYSTEM|MODULE)/.test(d))
    return { pvClass: 'CONFIRMED_PV', evidence: 'solar panel/array/system' }
  if (/ROOF\s*(TOP)?\s*MOUNT(ED)?\s*SOLAR|ROOFTOP\s*SOLAR/.test(d))
    return { pvClass: 'CONFIRMED_PV', evidence: 'rooftop-mounted solar' }

  // "SOLAR INSTALLATION" / "JONES SOLAR INSTALL" — an install of solar something,
  // on a residential roof permit. Real in every sample checked, but no explicit
  // PV token, so it lands one notch below CONFIRMED.
  if (/SOLAR\s*(INSTALL|INSTALLATION|PROJECT|POWER)/.test(d))
    return { pvClass: 'LIKELY_PV', evidence: 'solar install/project language' }
  if (/\bSOLAR\b/.test(d) && /INSTALL|ADD|NEW|MOUNT/.test(d))
    return { pvClass: 'LIKELY_PV', evidence: 'solar + install verb' }

  // A boilerplate work-type label. Not evidence of an array.
  if (/SKYLIGHT\s*\/\s*SOLAR\s*PANEL/.test(d))
    return { pvClass: 'AMBIGUOUS_SOLAR', evidence: 'Skylight/Solar Panel worktype boilerplate' }
  if (/\bSOLAR\b/.test(d)) return { pvClass: 'AMBIGUOUS_SOLAR', evidence: 'generic solar mention' }
  return { pvClass: 'AMBIGUOUS_SOLAR', evidence: 'no solar language' }
}

type Row = {
  id: string
  county: string
  pin: string | null
  issued_on: string | null
  pv_class: string
  permit_numbers: string[] | null
}

async function main() {
  console.log('=== Solar enrichment: roof age + PV reclassification ===')
  console.log(`mode ${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}\n`)

  const rows = await pagedSelect<Row>('solar_installs', 'id, county, pin, issued_on, pv_class, permit_numbers')
  console.log(`solar_installs: ${rows.length}`)

  // ---- 1. Permit descriptions (Mecklenburg) -> reclassify ----------------
  console.log('\n--- permit descriptions (mecklenburg) ---')
  const descByPermit = new Map<string, string>()
  const permits = await fetchAllArcGISFeatures(
    MECKLENBURG_BUILDING_PERMITS_URL,
    MECKLENBURG_LEGACY_SOLAR_WHERE,
    'permitnum,permitdesc,workdesc',
  )
  for (const f of permits) {
    const num = String(f.attributes.permitnum ?? '').trim()
    if (!num) continue
    const text = [f.attributes.permitdesc, f.attributes.workdesc]
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .join(' | ')
    if (text) descByPermit.set(num, text)
  }
  console.log(`  mecklenburg descriptions: ${descByPermit.size}`)

  // Cabarrus publishes DetailedDescription on its per-year layers. Its AMBIGUOUS
  // rows were never re-checked either — same boilerplate problem, smaller scale.
  const cabLayers = [
    ...CABARRUS_YEAR_LAYERS.map((l) => ({ label: String(l.year), url: `${CABARRUS_ARCGIS_BASE}/${l.layerId}` })),
    ...CABARRUS_HISTORICAL_PERMIT_LAYERS.map((l) => ({ label: `${l.year} hist`, url: l.url })),
  ]
  let cabCount = 0
  for (const layer of cabLayers) {
    try {
      // Cabarrus rejects narrowed outFields on some year layers (returns 0 features
      // or an error), so always ask for everything here — see collectors/cabarrus.ts.
      const feats = await fetchAllArcGISFeatures(layer.url, CABARRUS_SOLAR_WHERE, '*')
      for (const f of feats) {
        const num = String(f.attributes.PermitNumber ?? '').trim()
        const text = String(f.attributes.DetailedDescription ?? '').trim()
        if (num && text && !descByPermit.has(num)) {
          descByPermit.set(num, text)
          cabCount += 1
        }
      }
    } catch (err) {
      console.warn(`  cabarrus ${layer.label} failed: ${(err as Error).message}`)
    }
  }
  console.log(`  cabarrus descriptions: ${cabCount}`)
  console.log(`  total descriptions: ${descByPermit.size}`)

  type Update = {
    id: string
    permit_description?: string
    pv_class?: string
    pv_evidence?: string
    year_built?: number | null
    eff_year_built?: number | null
    year_built_source?: string
    roof_age_at_install?: number | null
    roof_age_now?: number | null
  }
  const updates = new Map<string, Update>()
  const put = (id: string, patch: Partial<Update>) => {
    updates.set(id, { ...(updates.get(id) ?? { id }), ...patch } as Update)
  }

  const transitions: Record<string, number> = {}
  for (const row of rows) {
    let desc: string | undefined
    for (const p of row.permit_numbers ?? []) {
      const hit = descByPermit.get(String(p).trim())
      if (hit) {
        desc = hit
        break
      }
    }
    if (!desc) continue
    const { pvClass, evidence } = classifyPv(desc)
    const patch: Partial<Update> = { permit_description: desc }
    if (pvClass !== row.pv_class) {
      patch.pv_class = pvClass
      patch.pv_evidence = evidence
      const k = `${row.pv_class} -> ${pvClass}`
      transitions[k] = (transitions[k] ?? 0) + 1
    }
    put(row.id, patch)
  }
  console.log('  reclassification:')
  Object.entries(transitions)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${String(v).padStart(5)}  ${k}`))
  if (!Object.keys(transitions).length) console.log('    (no changes)')

  // ---- 2. Year built ----------------------------------------------------
  console.log('\n--- year built ---')

  // Mecklenburg: CAMA keyed on pid. Oldest building on the parcel wins.
  const meckPins = Array.from(
    new Set(rows.filter((r) => r.county === 'mecklenburg' && r.pin).map((r) => String(r.pin))),
  )
  const yearByPin = new Map<string, { yb: number | null; eff: number | null }>()
  const CH = 200
  for (let i = 0; i < meckPins.length; i += CH) {
    const chunk = meckPins.slice(i, i + CH)
    const where = `pid IN (${chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')})`
    try {
      const feats = await fetchAllArcGISFeatures(MECK_CAMA_URL, where, 'pid,yearbuilt,effyearblt')
      for (const f of feats) {
        const pid = String(f.attributes.pid ?? '').trim()
        if (!pid) continue
        const yb = validYear(f.attributes.yearbuilt)
        const eff = validYear(f.attributes.effyearblt)
        const prev = yearByPin.get(pid)
        // Oldest structure on the parcel — a new garage must not mask an old house.
        yearByPin.set(pid, {
          yb: prev?.yb != null && yb != null ? Math.min(prev.yb, yb) : (yb ?? prev?.yb ?? null),
          eff: prev?.eff != null && eff != null ? Math.min(prev.eff, eff) : (eff ?? prev?.eff ?? null),
        })
      }
    } catch (err) {
      console.warn(`  meck chunk ${i} failed: ${(err as Error).message}`)
    }
    if (i % 2000 === 0) process.stdout.write(`\r  mecklenburg pins: ${Math.min(i + CH, meckPins.length)}/${meckPins.length}`)
  }
  console.log(`\r  mecklenburg pins resolved: ${yearByPin.size}/${meckPins.length}`)

  // Cabarrus: already loaded for the roof-age layer.
  const cabRows = await pagedSelect<{ pin: string; year_built: number }>(
    'canvass_parcel_years',
    'pin, year_built',
    (q) => q.eq('county', 'cabarrus'),
    'pin',
  )
  const cabByPin = new Map(cabRows.map((r) => [String(r.pin), Number(r.year_built)]))
  console.log(`  cabarrus parcel years available: ${cabByPin.size}`)

  const bySource: Record<string, number> = {}
  for (const row of rows) {
    let yb: number | null = null
    let eff: number | null = null
    let source: string | null = null

    if (row.county === 'mecklenburg' && row.pin) {
      const hit = yearByPin.get(String(row.pin))
      if (hit) {
        yb = hit.yb
        eff = hit.eff
        source = 'meck_cama'
      }
    } else if (row.county === 'cabarrus' && row.pin) {
      const hit = cabByPin.get(String(row.pin))
      if (hit) {
        yb = validYear(hit)
        source = 'canvass_parcel_years'
      }
    }
    if (yb == null && eff == null) continue

    // Prefer effective year built when it's later — a substantial renovation
    // usually included a re-roof, so it's the better roof proxy.
    const roofYear = Math.max(yb ?? 0, eff ?? 0) || null
    const installYear = row.issued_on ? Number(String(row.issued_on).slice(0, 4)) : null
    const roofAgeAtInstall =
      roofYear && installYear && installYear >= roofYear ? installYear - roofYear : null

    put(row.id, {
      year_built: yb,
      eff_year_built: eff,
      year_built_source: source ?? undefined,
      roof_age_at_install: roofAgeAtInstall,
      roof_age_now: roofYear ? CURRENT_YEAR - roofYear : null,
    })
    if (source) bySource[source] = (bySource[source] ?? 0) + 1
  }
  console.log(`  year built resolved: ${JSON.stringify(bySource)}`)

  const list = Array.from(updates.values())
  console.log(`\ntotal rows to update: ${list.length}`)

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to write.')
    return
  }

  let done = 0
  const now = new Date().toISOString()
  for (const u of list) {
    const { id, ...patch } = u
    const { error } = await supabase
      .from('solar_installs')
      .update({ ...patch, roof_age_refreshed_at: now })
      .eq('id', id)
    if (error) {
      console.error(`update ${id} failed: ${error.message}`)
      process.exit(1)
    }
    done += 1
    if (done % 250 === 0) process.stdout.write(`\r  updated ${done}/${list.length}`)
  }
  console.log(`\r  updated ${done}/${list.length}`)
  console.log('OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
