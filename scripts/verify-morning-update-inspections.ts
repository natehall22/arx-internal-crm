/**
 * Verify org-wide inspection set counts for morning update.
 * Usage: npx tsx scripts/verify-morning-update-inspections.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDateRangeForTimeFrame } from '../lib/date-ranges'
import {
  countOrgInspectionSetsInPeriod,
  countsAsInspectionSet,
  INSPECTION_SET_APPOINTMENT_TYPE_OR,
} from '../lib/inspection-set-metrics'
import { isSetterLikeRole } from '../lib/dashboard-setter-role'
import { fetchMorningUpdateMetrics } from '../lib/morning-update-metrics'
import { createServiceClient } from '../lib/supabase/service'

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
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
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    // ignore
  }
}

async function main() {
  loadEnvLocal()
  const supabase = createServiceClient()
  const { start, end } = getDateRangeForTimeFrame('month', 'America/New_York')
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const { data: org } = await supabase.from('orgs').select('id, name').limit(1).single()
  if (!org?.id) throw new Error('no org')

  const orgCount = await countOrgInspectionSetsInPeriod(supabase, {
    orgId: org.id,
    startIso,
    endIso,
  })

  const metrics = await fetchMorningUpdateMetrics(supabase, org.id)

  const { data } = await supabase
    .from('scheduled_appointments')
    .select('id, canvasser_user_id, closer_user_id, appointment_type, status')
    .eq('org_id', org.id)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .or(INSPECTION_SET_APPOINTMENT_TYPE_OR)

  const userIds = new Set<string>()
  for (const row of data || []) {
    if (row.canvasser_user_id) userIds.add(row.canvasser_user_id)
    if (row.closer_user_id) userIds.add(row.closer_user_id)
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, role')
    .in('id', Array.from(userIds))

  const roleById = new Map((users || []).map((u) => [u.id, u.role]))

  let setterCanvasserOnly = 0
  let nonSetterCanvasser = 0
  let closerOnly = 0

  for (const row of data || []) {
    if (!countsAsInspectionSet(row)) continue
    if (!row.canvasser_user_id && row.closer_user_id) {
      closerOnly += 1
      continue
    }
    if (!row.canvasser_user_id) continue
    const role = roleById.get(row.canvasser_user_id)
    if (isSetterLikeRole(role)) setterCanvasserOnly += 1
    else nonSetterCanvasser += 1
  }

  console.log(
    JSON.stringify(
      {
        org: org.name,
        monthToDate: {
          helperCount: orgCount,
          morningUpdateMetric: metrics.inspectionsScheduledMonthToDate,
          setterCanvasserOnly,
          nonSetterCanvasser,
          closerOnly,
          setterOnlyTotal: setterCanvasserOnly,
          orgWideIncludes: nonSetterCanvasser + closerOnly,
        },
      },
      null,
      2
    )
  )

  if (orgCount !== metrics.inspectionsScheduledMonthToDate) {
    throw new Error('countOrgInspectionSetsInPeriod does not match morning update metric')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
