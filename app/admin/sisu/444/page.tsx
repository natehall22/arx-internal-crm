import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Program444Client from './Program444Client'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Program444Page() {
  const { profile } = await requireAuth()
  const supabase = createClient()

  const { data: orgRow } = await supabase
    .from('orgs')
    .select('program_444_week_bonus_label')
    .eq('id', profile.org_id)
    .maybeSingle()

  const weekBonusLabel = orgRow?.program_444_week_bonus_label ?? '$400'

  return <Program444Client weekBonusLabel={weekBonusLabel} />
}
