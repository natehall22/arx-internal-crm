/**
 * Send a test morning update email.
 * Usage: npx tsx scripts/send-morning-update-test.ts [email]
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServiceClient } from '../lib/supabase/service'
import { sendMorningUpdateEmail } from '../lib/morning-update-email'

function loadEnvLocal() {
  try {
    const envPath = resolve(process.cwd(), '.env.local')
    const raw = readFileSync(envPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  } catch {
    // .env.local optional when env is already exported
  }
}

async function main() {
  loadEnvLocal()

  const explicitEmail = process.argv[2]?.trim()
  const supabase = createServiceClient()

  const { data: orgs, error: orgError } = await supabase.from('orgs').select('id, name').limit(1)
  if (orgError || !orgs?.[0]?.id) {
    throw new Error(orgError?.message || 'No org found')
  }

  const orgId = orgs[0].id as string
  let testEmail = explicitEmail

  if (!testEmail) {
    const { data: owners, error: ownerError } = await supabase
      .from('users')
      .select('email, role, full_name')
      .eq('org_id', orgId)
      .eq('active', true)
      .in('role', ['owner', 'admin'])
      .order('role', { ascending: true })

    if (ownerError) throw ownerError
    testEmail =
      owners?.find((user) => typeof user.email === 'string' && user.email.includes('@'))?.email ||
      undefined
  }

  if (!testEmail?.includes('@')) {
    throw new Error('No recipient email. Pass one: npx tsx scripts/send-morning-update-test.ts you@example.com')
  }

  console.log(`Sending test morning update for org ${orgs[0].name || orgId} to ${testEmail}...`)

  const result = await sendMorningUpdateEmail(supabase, {
    orgId,
    testToEmails: [testEmail],
  })

  if (result.skipped) {
    throw new Error(result.reason || 'Test email was not sent')
  }

  console.log(`Sent ${result.sent} test email(s).`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
