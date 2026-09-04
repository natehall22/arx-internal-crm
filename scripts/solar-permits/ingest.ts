/**
 * Ingest the local solar-permit extract into the CRM.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/ingest.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/solar-permits/ingest.ts --commit   # writes
 *
 * Dry run is the DEFAULT and prints exactly what would change. Nothing is
 * written without --commit.
 *
 * Reads:
 *   data/unique-properties-expanded.json  — one row per property, from extract+expand
 *   installer-status.ts                   — researched business status per installer
 *
 * Writes (idempotent upserts, safe to re-run):
 *   solar_installers  keyed on name_key   (canonical alias key — variants merge)
 *   solar_installs    keyed on property_key
 *
 * NON_PV rows are skipped: solar-thermal, solar-ready and solar-farm permits are
 * not rooftop arrays and must never reach a map or a mailer. They stay
 * regenerable from the extract if ever needed.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getInstallerStatus,
  isNonInstallerEntity,
  resolveAliasGroup,
  resolveCanonicalFrequencyKey,
  toFrequencyKey,
  type InstallerStatusRecord,
} from './installer-status'

/**
 * Is this contractor string a real company we should register?
 *
 * Order matters. `isNonInstallerEntity` is a heuristic that also screens out
 * person names, and it misfires on digit-substituted typos in county records —
 * it rejects "P0WER HOME SOLAR", which is a Pink Energy property we very much
 * want. So: if the name resolves to a researched alias group, it IS an installer
 * and the heuristic doesn't get a vote. The heuristic only judges names we know
 * nothing about.
 *
 * Fixed here rather than in installer-status.ts so the existing audit reports
 * keep producing identical output until that change can be reviewed.
 */
function isRegisterableInstaller(contractorKey: string): boolean {
  const canonical = resolveCanonicalFrequencyKey(toFrequencyKey(contractorKey))
  if (resolveAliasGroup(canonical)) return true
  return !isNonInstallerEntity(contractorKey)
}

type ExtractRow = {
  propertyKey: string
  sourceCounty: string
  pin: string | null
  address: string | null
  city: string | null
  zip: string | null
  issuedOn: string | null
  yearsSinceInstall: number | null
  contractor: string | null
  contractorKey: string | null
  permitNumbers: string[]
  permitCount: number
  isCommercial: boolean
  hasInstaller: boolean
  pvClass: string
  pvEvidence: string | null
}

const COMMIT = process.argv.includes('--commit')
const DATA = join(__dirname, 'data', 'unique-properties-expanded.json')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Research vocabulary → the DB's status enum. */
function toDbStatus(status: InstallerStatusRecord['status']): string {
  switch (status) {
    case 'ACTIVE':
      return 'active'
    case 'DEFUNCT':
    case 'BANKRUPT':
    case 'DISSOLVED':
      return 'defunct'
    case 'ACQUIRED':
      return 'acquired'
    case 'NO_LONGER_SERVICING_MARKET':
      return 'no_longer_servicing'
    default:
      return 'unknown'
  }
}

/**
 * Can this homeowner get anyone to service their system?
 *
 * Deliberately broader than "defunct" — ADT Solar still exists but stopped
 * servicing residential PV, which strands its customers just as completely.
 * Deliberately narrower than "not active" — UNKNOWN is not evidence of anything
 * and must never drive an outbound claim.
 */
function isServiceOrphaned(record: InstallerStatusRecord): boolean {
  const terminal =
    record.status === 'DEFUNCT' ||
    record.status === 'BANKRUPT' ||
    record.status === 'DISSOLVED' ||
    record.status === 'NO_LONGER_SERVICING_MARKET'
  if (!terminal) return false
  // A successor that still services the fleet means they are not stranded.
  return record.successorStillServicesSystems !== 'yes'
}

async function main() {
  const rows: ExtractRow[] = JSON.parse(readFileSync(DATA, 'utf8'))
  const usable = rows.filter((r) => r.pvClass !== 'NON_PV')
  const skippedNonPv = rows.length - usable.length

  // ---- Installers -------------------------------------------------------
  // Collapse alias variants onto one canonical row so "P0WER HOME SOLAR" and
  // "POWER HOME SOLAR" become a single company, with both spellings recorded.
  type InstallerAgg = {
    nameKey: string
    displayName: string
    variants: Set<string>
    record: InstallerStatusRecord
    propertyCount: number
  }
  const installers = new Map<string, InstallerAgg>()

  for (const row of usable) {
    if (!row.contractor || !row.contractorKey) continue
    if (!isRegisterableInstaller(row.contractorKey)) continue

    const canonical = resolveCanonicalFrequencyKey(toFrequencyKey(row.contractorKey))
    let agg = installers.get(canonical)
    if (!agg) {
      const group = resolveAliasGroup(canonical)
      agg = {
        nameKey: canonical,
        displayName: group?.displayName || row.contractorKey,
        variants: new Set(),
        record: getInstallerStatus(canonical, row.contractorKey),
        propertyCount: 0,
      }
      installers.set(canonical, agg)
    }
    agg.variants.add(row.contractor)
    agg.propertyCount += 1
  }

  const installerRows = Array.from(installers.values()).map((a) => ({
    name_key: a.nameKey,
    display_name: a.displayName,
    status: toDbStatus(a.record.status),
    status_source: 'manual',
    status_confidence: a.record.confidence,
    status_detail: a.record.notes || null,
    evidence_summary: a.record.evidenceSummary || null,
    source_urls: [a.record.source1, a.record.source2].filter(Boolean),
    successor_company: a.record.successorCompany || null,
    successor_services_systems:
      a.record.successorStillServicesSystems === 'unknown'
        ? null
        : a.record.successorStillServicesSystems === 'yes',
    service_orphaned: isServiceOrphaned(a.record),
    raw_variants: Array.from(a.variants),
    status_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  const orphanedInstallers = installerRows.filter((r) => r.service_orphaned)
  const orphanedProperties = Array.from(installers.values())
    .filter((a) => isServiceOrphaned(a.record))
    .reduce((sum, a) => sum + a.propertyCount, 0)

  console.log('=== Solar permit ingest ===')
  console.log(`mode                 ${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}`)
  console.log(`extract rows         ${rows.length}`)
  console.log(`skipped NON_PV       ${skippedNonPv}`)
  console.log(`installs to upsert   ${usable.length}`)
  console.log(`installers to upsert ${installerRows.length}`)
  console.log(`  service-orphaned   ${orphanedInstallers.length} companies / ${orphanedProperties} properties`)
  const byClass: Record<string, number> = {}
  usable.forEach((r) => {
    byClass[r.pvClass] = (byClass[r.pvClass] ?? 0) + 1
  })
  console.log(`by pv_class          ${JSON.stringify(byClass)}`)
  console.log('orphaned companies:')
  orphanedInstallers.forEach((r) => {
    const agg = installers.get(r.name_key)!
    console.log(`  ${r.display_name.padEnd(38)} ${String(agg.propertyCount).padStart(4)} props  ${r.status}/${r.status_confidence}`)
  })

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to write.')
    return
  }

  // ---- Write installers -------------------------------------------------
  const { error: instErr } = await supabase
    .from('solar_installers')
    .upsert(installerRows, { onConflict: 'name_key' })
  if (instErr) {
    console.error('installer upsert failed:', instErr.message)
    process.exit(1)
  }

  const { data: saved, error: readErr } = await supabase
    .from('solar_installers')
    .select('id, name_key')
  if (readErr) {
    console.error('installer read-back failed:', readErr.message)
    process.exit(1)
  }
  const idByKey = new Map((saved ?? []).map((r) => [r.name_key as string, r.id as string]))

  // ---- Write installs ---------------------------------------------------
  const installRows = usable.map((row) => {
    const canonical =
      row.contractorKey && isRegisterableInstaller(row.contractorKey)
        ? resolveCanonicalFrequencyKey(toFrequencyKey(row.contractorKey))
        : null
    return {
      property_key: row.propertyKey,
      county: row.sourceCounty.toLowerCase(),
      pin: row.pin,
      address: row.address,
      permit_number: row.permitNumbers?.[0] ?? null,
      permit_numbers: row.permitNumbers ?? [],
      issued_on: row.issuedOn,
      years_since_install: row.yearsSinceInstall,
      installer_name_raw: row.contractor,
      installer_id: canonical ? idByKey.get(canonical) ?? null : null,
      is_commercial: row.isCommercial,
      pv_class: row.pvClass,
      pv_evidence: row.pvEvidence,
      source: 'county_arcgis_bulk',
      refreshed_at: new Date().toISOString(),
    }
  })

  const CHUNK = 500
  let written = 0
  for (let i = 0; i < installRows.length; i += CHUNK) {
    const chunk = installRows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('solar_installs')
      .upsert(chunk, { onConflict: 'property_key' })
    if (error) {
      console.error(`install upsert failed at row ${i}:`, error.message)
      process.exit(1)
    }
    written += chunk.length
    process.stdout.write(`\r  installs written: ${written}/${installRows.length}`)
  }
  console.log()

  // ---- Verify -----------------------------------------------------------
  const { count: installCount } = await supabase
    .from('solar_installs')
    .select('id', { count: 'exact', head: true })
  const { count: linkedCount } = await supabase
    .from('solar_installs')
    .select('id', { count: 'exact', head: true })
    .not('installer_id', 'is', null)

  console.log('\n=== Verification ===')
  console.log(`solar_installs rows      ${installCount}`)
  console.log(`  with installer linked  ${linkedCount}`)
  console.log(`solar_installers rows    ${idByKey.size}`)
  if (installCount !== usable.length) {
    console.error(`MISMATCH: expected ${usable.length} installs, found ${installCount}`)
    process.exit(1)
  }
  console.log('OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
