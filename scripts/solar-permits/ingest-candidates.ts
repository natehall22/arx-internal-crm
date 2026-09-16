/**
 * Load imagery-detected solar candidates into the CRM for rep verification.
 *
 *   npx tsx --env-file=.env.local scripts/solar-permits/ingest-candidates.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/solar-permits/ingest-candidates.ts --commit
 *
 * Reads the newest solar-candidates-*.csv and upserts into `solar_candidates`,
 * keyed on (county, pin) so re-running is safe.
 *
 * These rows EXPIRE. Google allows 30 days of caching, so expires_at is set from
 * the detection date and the canvass route filters on it — an un-purged table
 * still stops showing stale rows. Do not copy these into solar_installs; that
 * table is permit-confirmed public record and has no expiry.
 *
 * Anything a rep has already verified is left alone: verified_has_solar and its
 * timestamp are never overwritten by a re-ingest.
 */

import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const COMMIT = process.argv.includes('--commit')
const DATA = join(__dirname, 'data')
const CACHE_DAYS = 30

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Minimal CSV line parser — fields may be quoted and contain commas. */
function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

function newestCandidateFile(): string {
  const files = readdirSync(DATA)
    .filter((f) => /^solar-candidates-.*\.csv$/.test(f))
    .sort()
  if (!files.length) {
    console.error('No solar-candidates-*.csv found. Run solar-permits:candidates first.')
    process.exit(1)
  }
  return join(DATA, files[files.length - 1])
}

function num(v: string | undefined): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function main() {
  const file = newestCandidateFile()
  console.log('=== Ingest solar candidates ===')
  console.log(`mode   ${COMMIT ? 'COMMIT' : 'DRY RUN (no writes)'}`)
  console.log(`source ${file}\n`)

  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  // Leading '#' lines are the provenance/expiry banner.
  const headerIdx = lines.findIndex((l) => !l.startsWith('#'))
  const headers = parseLine(lines[headerIdx])
  const col = (row: string[], name: string) => row[headers.indexOf(name)]

  const expiresAt = new Date(Date.now() + CACHE_DAYS * 864e5).toISOString()

  const rows = lines.slice(headerIdx + 1).map((l) => {
    const c = parseLine(l)
    const lat = num(col(c, 'lat'))
    const lng = num(col(c, 'lng'))
    const imagery = col(c, 'imagery_date')
    return {
      county: 'cabarrus',
      pin: col(c, 'pin') || null,
      lat,
      lng,
      owner_name: col(c, 'owner') || null,
      mailing_address: col(c, 'mailing_address') || null,
      mailing_city: col(c, 'mailing_city') || null,
      mailing_state: col(c, 'mailing_state') || null,
      mailing_zip: col(c, 'mailing_zip') || null,
      subdivision: col(c, 'subdivision') || null,
      imagery_date: imagery && /^\d{4}-\d{2}-\d{2}$/.test(imagery) ? imagery : null,
      meters_to_nearest_known_solar: num(col(c, 'meters_to_nearest_known_solar')),
      source: 'google_solar_api',
      expires_at: expiresAt,
    }
  })

  const usable = rows.filter((r) => r.lat != null && r.lng != null && r.pin)
  console.log(`rows in file:   ${rows.length}`)
  console.log(`usable:         ${usable.length}`)
  console.log(`with owner:     ${usable.filter((r) => r.owner_name).length}`)
  console.log(`expires_at:     ${expiresAt.slice(0, 10)}`)

  if (!COMMIT) {
    console.log('\nDry run complete. Re-run with --commit to write.')
    return
  }

  // Never clobber a rep's answer on re-ingest.
  const { data: verified } = await supabase
    .from('solar_candidates')
    .select('pin')
    .eq('county', 'cabarrus')
    .not('verified_has_solar', 'is', null)
  const locked = new Set((verified ?? []).map((v) => String(v.pin)))
  if (locked.size) console.log(`preserving ${locked.size} rep-verified rows`)

  const toWrite = usable.filter((r) => !locked.has(String(r.pin)))
  const { error } = await supabase
    .from('solar_candidates')
    .upsert(toWrite, { onConflict: 'county,pin' })
  if (error) {
    console.error(`upsert failed: ${error.message}`)
    process.exit(1)
  }

  const { count } = await supabase
    .from('solar_candidates')
    .select('id', { count: 'exact', head: true })
  const { count: live } = await supabase
    .from('solar_candidates')
    .select('id', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString())
    .is('verified_has_solar', null)

  console.log('\n=== Verification ===')
  console.log(`solar_candidates rows: ${count}`)
  console.log(`  live + unverified:   ${live}`)
  console.log('OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
