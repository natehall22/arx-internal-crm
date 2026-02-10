import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { calculateEstimateTotals } from '@/lib/calculations'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { profile } = await requireAuth()
  const supabase = createClient()
  const body = await request.json()

  // Verify estimate belongs to user's org
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!estimate) {
    return NextResponse.json({ error: 'Estimate not found' }, { status: 404 })
  }

  const { data: line, error } = await supabase
    .from('estimate_lines')
    .insert({
      ...body,
      estimate_id: params.id,
      org_id: profile.org_id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Recalculate totals
  const { data: allLines } = await supabase
    .from('estimate_lines')
    .select('*')
    .eq('estimate_id', params.id)

  if (allLines) {
    const totals = calculateEstimateTotals(
      allLines,
      estimate.steep_multiplier_pct,
      estimate.high_multiplier_pct,
      estimate.tax_rate,
      estimate.discount_amount
    )

    await supabase
      .from('estimates')
      .update({
        subtotal: totals.subtotal,
        tax: totals.tax,
        total: totals.total,
      })
      .eq('id', params.id)
  }

  return NextResponse.json(line)
}
