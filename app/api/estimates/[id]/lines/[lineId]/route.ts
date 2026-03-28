import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { calculateEstimateTotals } from '@/lib/calculations'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; lineId: string } }
) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const rawBody = await request.json()

  const ALLOWED_FIELDS = new Set([
    'name', 'category', 'unit', 'qty', 'unit_price', 'line_total',
    'is_labor', 'is_taxable', 'sort_order', 'pricebook_item_id',
  ])
  const body: Record<string, unknown> = {}
  for (const key of Object.keys(rawBody)) {
    if (ALLOWED_FIELDS.has(key)) body[key] = rawBody[key]
  }

  const { data: line, error } = await supabase
    .from('estimate_lines')
    .update(body)
    .eq('id', params.lineId)
    .eq('org_id', profile.org_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Recalculate totals
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (estimate) {
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
  }

  return NextResponse.json(line)
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string; lineId: string } }
) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()

  const { error } = await supabase
    .from('estimate_lines')
    .delete()
    .eq('id', params.lineId)
    .eq('org_id', profile.org_id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Recalculate totals
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (estimate) {
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
  }

  return NextResponse.json({ success: true })
}
