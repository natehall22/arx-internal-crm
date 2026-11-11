/**
 * Seed (or re-sync) ONE company's org — multi-company plan slice 9. Logic: lib/company-seed.ts.
 *
 *   npm run seed:company -- path/to/company.json            # dry run: prints what it would do, writes nothing
 *   npm run seed:company -- path/to/company.json --apply    # writes
 *
 * Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (point it at another env file with
 * `npx tsx --env-file=.env.company scripts/seed-company.ts …`). If that env sets DEPLOYMENT_ORG_ID, the run refuses any
 * other org. An org that already has jobs, deals or customers needs --allow-existing; a second super admin needs
 * --add-owner. A new owner login gets SEED_OWNER_PASSWORD from the environment, else a random password printed once.
 * Optional "profile" (roofing | lawn_landscape | exterior_cleaning | home_builder, lib/industry-profiles.ts) sets the
 * industry profile and, when "trades" is left out, its starting trades; `--profile=<id>` overrides the file.
 * Optional org.subdomain sets the company web address (needs migration 202611100070). Input shape: scripts/seed-company.example.json. Safe to re-run; put the printed org id into org.id after the first run.
 */
import { readFileSync } from 'fs'

import { createClient } from '@supabase/supabase-js'

import { parseCompanySeedInput, runCompanySeed, SeedStop } from '@/lib/company-seed'
import { deploymentOrgId } from '@/lib/company-host'

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const apply = args.includes('--apply')
  const allowExisting = args.includes('--allow-existing')
  const addOwner = args.includes('--add-owner')
  const profileArg = args.find((a) => a.startsWith('--profile='))?.slice('--profile='.length)
  if (!file) {
    console.error('usage: seed-company <input.json> [--apply] [--allow-existing] [--add-owner] [--profile=<id>]')
    process.exit(2)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }

  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const parsed = parseCompanySeedInput(profileArg ? { ...raw, profile: profileArg } : raw)
  if (!parsed.ok) {
    console.error(`Input problems in ${file}:\n  - ${parsed.errors.join('\n  - ')}`)
    process.exit(2)
  }

  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  console.log(`${apply ? 'APPLY' : 'DRY RUN (nothing is written; add --apply)'} — ${new URL(url).host}`)
  try {
    const report = await runCompanySeed(client, parsed.input, {
      apply,
      deploymentOrgId: deploymentOrgId(),
      ownerPassword: process.env.SEED_OWNER_PASSWORD,
      allowExisting,
      addOwner,
    })
    for (const line of report.lines) console.log(`  ${line}`)
    if (report.generatedOwnerPassword) {
      console.log(`\n  Owner first password (shown once — have them change it): ${report.generatedOwnerPassword}`)
    }
    if (report.orgId) console.log(`\n  Set DEPLOYMENT_ORG_ID=${report.orgId} on this company's deployment.`)
  } catch (e) {
    console.error(e instanceof SeedStop ? `Refused: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`)
    if (!(e instanceof SeedStop) && apply) console.error('Writes made before the failure stay; fix the cause and re-run (it is safe).')
    process.exit(1)
  }
}

main()
