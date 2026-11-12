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
 *
 *   npm run seed:company -- --demo [--apply] [--reset] [--name="…"] [--logo-url=https://…] [--profile=<id>]
 *
 * --demo builds ONE fictional company ("Gulf Coast Grounds & Exterior", lawn_landscape, address `demo`) with sample data
 * for sales demos; no input file. The org carries the database flag `is_demo`: outbound email / texts are only logged, Stripe
 * is test-only, QuickBooks and a real texting number are refused. Dry run unless --apply. --reset wipes that demo company
 * (never any other: it needs the flag) and rebuilds it. Logins are printed once, never stored.
 *
 * Optional org.subdomain sets the company web address (needs migration 202611100070). Input shape: scripts/seed-company.example.json. Safe to re-run; put the printed org id into org.id after the first run.
 */
import { readFileSync } from 'fs'

import { createClient } from '@supabase/supabase-js'

import { parseCompanySeedInput, runCompanySeed, SeedStop } from '@/lib/company-seed'
import { demoSeedRaw } from '@/lib/demo-company-data'
import { setDemoLogoFromUrl } from '@/lib/demo-logo'
import { deploymentOrgId } from '@/lib/company-host'

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const demo = args.includes('--demo')
  const reset = args.includes('--reset')
  const nameArg = args.find((a) => a.startsWith('--name='))?.slice('--name='.length)
  const logoArg = args.find((a) => a.startsWith('--logo-url='))?.slice('--logo-url='.length)
  const apply = args.includes('--apply')
  const allowExisting = args.includes('--allow-existing')
  const addOwner = args.includes('--add-owner')
  const profileArg = args.find((a) => a.startsWith('--profile='))?.slice('--profile='.length)
  if (reset && !demo) {
    console.error('--reset only works with --demo (it wipes the demo company and nothing else)')
    process.exit(2)
  }
  if (!demo && (nameArg || logoArg)) {
    console.error('--name and --logo-url are for --demo')
    process.exit(2)
  }
  if (!demo && !file) {
    console.error('usage: seed-company <input.json> [--apply] [--allow-existing] [--add-owner] [--profile=<id>]\n       seed-company --demo [--apply] [--reset] [--name=…] [--logo-url=https://…] [--profile=<id>]')
    process.exit(2)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }

  const raw = demo ? demoSeedRaw({ name: nameArg, profile: profileArg }) : JSON.parse(readFileSync(file!, 'utf8'))
  const parsed = parseCompanySeedInput(profileArg && !demo ? { ...raw, profile: profileArg } : raw)
  if (!parsed.ok) {
    console.error(`Input problems in ${file ?? 'the demo defaults'}:\n  - ${parsed.errors.join('\n  - ')}`)
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
      reset,
    })
    for (const line of report.lines) console.log(`  ${line}`)
    if (demo && apply && report.orgId && logoArg) {
      await setDemoLogoFromUrl(client, report.orgId, logoArg)
      console.log('  logo: stored')
    }
    if (report.demo) {
      console.log('\n  DEMO LOGINS (shown once; not stored anywhere — write them down now):')
      for (const l of report.demo.logins) console.log(`    ${l.role.padEnd(10)} ${l.email}  ${l.password}`)
      if (report.demo.portalLink) console.log(`    portal customer (single-use magic link, 7 days): ${report.demo.portalLink}`)
      if (report.demo.skipped.length) console.log(`\n  ${report.demo.skipped.length} demo section(s) could not run — see "demo SKIPPED" above.`)
    } else if (report.generatedOwnerPassword) {
      console.log(`\n  Owner first password (shown once — have them change it): ${report.generatedOwnerPassword}`)
    }
    if (report.orgId && !demo) console.log(`\n  Set DEPLOYMENT_ORG_ID=${report.orgId} on this company's deployment.`)
  } catch (e) {
    console.error(e instanceof SeedStop ? `Refused: ${e.message}` : `Failed: ${e instanceof Error ? e.message : String(e)}`)
    if (!(e instanceof SeedStop) && apply) console.error('Writes made before the failure stay; fix the cause and re-run (it is safe).')
    process.exit(1)
  }
}

main()
