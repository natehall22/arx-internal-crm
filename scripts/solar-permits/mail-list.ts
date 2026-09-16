/**
 * Build the direct-mail list from ingested solar installs.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/mail-list.ts
 *   npx tsx --env-file=.env.local scripts/solar-permits/mail-list.ts --include-suppressed
 *
 * Writes data/mail-list.csv (gitignored). Read-only against the CRM.
 *
 * WHY DIRECT MAIL: it is the only outbound channel with no consent regime and no
 * per-piece statutory damages. Phone and SMS to this list would be TCPA exposure
 * at $500-$1,500 per contact. Do not repurpose this file for dialing.
 *
 * NO TIERS, BY DESIGN. Every home with solar is a candidate. A penetration that
 * was never flashed properly leaks on a two-year-old roof — bad sealant, a lag
 * bolt that missed the rafter, sloppy step flashing. That failure is the INSTALL,
 * not the wear, so neither system age nor roof age gates the list.
 *
 * Age and installer data still ride along as columns: useful at the door
 * ("your system is 11 years old and went on a roof that was already 12"), never
 * as a filter. Sorted oldest-first only so a partial mail drop starts somewhere
 * defensible — not because newer homes are excluded.
 *
 * `orphan_claim_safe` is the legal guardrail, carried per row. It is TRUE only
 * when a specific company's death is documented at HIGH confidence. Copy that
 * names the installer or asserts "your installer is out of business" may ONLY go
 * to rows where this is true. Everything else gets generic copy — many systems in
 * this area were installed by companies no longer in business — which is provable
 * and names nobody. NC's UDTPA needs no intent to deceive.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const INCLUDE_SUPPRESSED = args.includes('--include-suppressed')
const OUT = join(__dirname, 'data', 'mail-list.csv')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

type Row = {
  id: string
  property_key: string
  county: string
  address: string | null
  pin: string | null
  lat: number | null
  lng: number | null
  issued_on: string | null
  years_since_install: number | null
  roof_age_at_install: number | null
  roof_age_now: number | null
  current_owner_name: string | null
  installer_name_raw: string | null
  pv_class: string
  is_commercial: boolean
  solar_installers: {
    display_name: string | null
    status: string | null
    status_confidence: string | null
    service_orphaned: boolean | null
  } | null
}

/**
 * Street-identity key for suppression. Deliberately loose — over-suppressing
 * costs one mailer, under-suppressing means soliciting an existing customer.
 */
function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const first = address.split(',')[0]
  const norm = first
    .toUpperCase()
    .replace(/\b(APT|UNIT|STE|SUITE|#)\s*[\w-]+/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return norm || null
}

function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function pagedSelect<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      console.error(`read ${table} failed: ${error.message}`)
      process.exit(1)
    }
    out.push(...((data ?? []) as unknown as T[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function main() {
  console.log('=== Solar mail list ===')

  const rows = await pagedSelect<Row>(
    'solar_installs',
    'id, property_key, county, address, pin, lat, lng, issued_on, years_since_install, roof_age_at_install, roof_age_now, current_owner_name, installer_name_raw, pv_class, is_commercial, solar_installers(display_name, status, status_confidence, service_orphaned)',
  )
  console.log(`solar_installs read: ${rows.length}`)

  // Existing CRM addresses — never solicit someone we already work with.
  const suppress = new Set<string>()
  for (const table of ['leads', 'customers', 'opportunities', 'production_jobs']) {
    const recs = await pagedSelect<{ address_text: string | null }>(table, 'id, address_text')
    let added = 0
    for (const r of recs) {
      const k = addressKey(r.address_text)
      if (k && !suppress.has(k)) {
        suppress.add(k)
        added += 1
      }
    }
    console.log(`  suppression from ${table}: ${recs.length} rows → ${added} new keys`)
  }
  console.log(`suppression keys: ${suppress.size}`)

  const mailable = rows.filter(
    (r) =>
      !r.is_commercial &&
      (r.pv_class === 'CONFIRMED_PV' || r.pv_class === 'LIKELY_PV') &&
      Boolean(r.address),
  )
  console.log(`mailable (residential, confirmed/likely PV, has address): ${mailable.length}`)

  const out = mailable
    .map((r) => {
      const inst = r.solar_installers
      const orphaned = inst?.service_orphaned === true
      const claimSafe =
        orphaned && inst?.status_confidence === 'HIGH' && inst?.status === 'defunct'
      const key = addressKey(r.address)
      return {
        suppressed: key ? suppress.has(key) : false,
        owner_name: r.current_owner_name ?? '',
        address: r.address ?? '',
        county: r.county,
        pin: r.pin ?? '',
        installed_on: r.issued_on ?? '',
        system_age_years: r.years_since_install ?? '',
        roof_age_at_install: r.roof_age_at_install ?? '',
        roof_age_now: r.roof_age_now ?? '',
        installer: inst?.display_name ?? '',
        installer_status: inst?.status ?? 'unknown',
        status_confidence: inst?.status_confidence ?? '',
        service_orphaned: orphaned,
        orphan_claim_safe: claimSafe,
        pv_class: r.pv_class,
        lat: r.lat ?? '',
        lng: r.lng ?? '',
        property_key: r.property_key,
      }
    })
    .filter((r) => (INCLUDE_SUPPRESSED ? true : !r.suppressed))
    // Oldest system first — an ordering for partial drops, not a gate.
    .sort((a, b) => Number(b.system_age_years || 0) - Number(a.system_age_years || 0))

  const headers = Object.keys(out[0] ?? { tier: '' })
  const csv = [
    headers.join(','),
    ...out.map((r) => headers.map((h) => csvEscape((r as Record<string, unknown>)[h])).join(',')),
  ].join('\n')
  writeFileSync(OUT, `${csv}\n`)

  const suppressedCount = mailable.length - out.length

  console.log('\n=== Result ===')
  console.log(`written: ${OUT}`)
  console.log(`rows:    ${out.length}`)
  console.log(`suppressed/filtered out: ${suppressedCount}`)
  console.log(`with owner name: ${out.filter((r) => r.owner_name).length}`)
  console.log(`orphan_claim_safe (may name the installer): ${out.filter((r) => r.orphan_claim_safe).length}`)
  console.log('\nOldest systems:')
  out
    .slice(0, 8)
    .forEach((r) => {
      console.log(
        `  ${String(r.system_age_years).padStart(2)}yr  ${(r.installer || '—').padEnd(32)} ${r.address}`,
      )
    })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
