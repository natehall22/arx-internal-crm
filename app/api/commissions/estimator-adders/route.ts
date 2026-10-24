import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * Adders for the commission estimator. The estimator used to read pricebook_items with the browser session; that table is closed to
 * setters/canvassers (its rows carry cost), so they get exactly the columns the estimator needs here and nothing else.
 */
export async function GET() {
  let profile
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await createServiceClient()
    .from('pricebook_items')
    .select('id, name, unit_price, price_type, is_commissionable, commission_percent, commission_cap, manager_spo_enabled, manager_spo_percent, unit')
    .eq('org_id', profile.org_id)
    .eq('is_adder', true)
    .eq('active', true)
    .order('name')
  if (error) return NextResponse.json({ error: 'Failed to load adders' }, { status: 500 })
  return NextResponse.json({ adders: data ?? [] })
}
