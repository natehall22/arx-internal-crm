/**
 * Load a price list file into ONE company. Logic: lib/price-list-import.ts.
 *
 *   npm run import:price-list -- data/precision-builder-pricing.json --org=<org id> --company-name="<exact name>"           # dry run, writes nothing
 *   npm run import:price-list -- data/precision-builder-pricing.json --org=<org id> --company-name="<exact name>" --apply   # writes
 *
 * Refuses an id that is not a company, a company on the roofing profile (or with none), and a name that does not match.
 *
 * Needs migration 202611220030 applied first. Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Safe to re-run: items already in the list (by name) are left untouched.
 */
import { readFileSync } from 'fs'

import { createClient } from '@supabase/supabase-js'

import { applyPriceListFile, ImportRefused, parsePriceListFile } from '@/lib/price-list-import'

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const orgId = args.find((a) => a.startsWith('--org='))?.slice('--org='.length)
  const companyName = args.find((a) => a.startsWith('--company-name='))?.slice('--company-name='.length)
  const apply = args.includes('--apply')
  if (!file || !orgId || !companyName) {
    console.error('usage: import-price-list <file.json> --org=<org id> --company-name="<exact name>" [--apply]')
    process.exit(2)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  const parsed = parsePriceListFile(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.ok) {
    console.error(`Problems in ${file}:\n  - ${parsed.errors.join('\n  - ')}`)
    process.exit(2)
  }
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written; add --apply)'} — ${new URL(url).host}`)
  try {
    for (const line of await applyPriceListFile(client, orgId, parsed.file, apply, companyName)) console.log(line)
  } catch (e) {
    console.error(e instanceof ImportRefused ? `Refused: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}

main()
