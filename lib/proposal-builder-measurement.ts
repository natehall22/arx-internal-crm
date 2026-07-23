import type { SupabaseClient } from '@supabase/supabase-js'

export async function loadBuilderMeasurement(
  adminClient: SupabaseClient,
  orgId: string,
  measurementId: string | null,
  opportunityId: string | null
) {
  if (measurementId) {
    const { data: measurement } = await adminClient
      .from('roof_measurements')
      .select('*')
      .eq('id', measurementId)
      .eq('org_id', orgId)
      .maybeSingle()

    if (measurement) return measurement
  }

  if (opportunityId) {
    const { data: measurement } = await adminClient
      .from('roof_measurements')
      .select('*')
      .eq('opportunity_id', opportunityId)
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (measurement) return measurement
  }

  return null
}
