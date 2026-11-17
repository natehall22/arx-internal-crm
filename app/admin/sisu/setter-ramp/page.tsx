import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getOrgFeatures } from '@/lib/org-features-server'
import SetterRampClient from './SetterRampClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SetterRampPage() {
  const { profile } = await requireAuth()
  // Setter ramp is pay for door-knocking setters: it exists with the Sisu program or with canvassing, never for a company with neither.
  const features = await getOrgFeatures(profile.org_id)
  if (!features.incentives && !features.canvassing) notFound()
  const supabase = createClient()

  const { data: orgRow } = await supabase
    .from('orgs')
    .select('setter_ramp_weekly_floor_amount, setter_ramp_commission_rate, setter_ramp_week3_avg_target, setter_ramp_avg_window_weeks')
    .eq('id', profile.org_id)
    .maybeSingle()

  return (
    <SetterRampClient
      weeklyFloorAmount={Number(orgRow?.setter_ramp_weekly_floor_amount ?? 500)}
      commissionRate={Number(orgRow?.setter_ramp_commission_rate ?? 3)}
      week3AvgTarget={Number(orgRow?.setter_ramp_week3_avg_target ?? 10)}
      avgWindowWeeks={Number(orgRow?.setter_ramp_avg_window_weeks ?? 4)}
    />
  )
}
