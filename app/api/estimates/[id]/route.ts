import { requireAuthApi } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { profile } = await requireAuthApi()
  const supabase = createClient()
  const body = await request.json()

  const ALLOWED_FIELDS = new Set([
    'steep_multiplier_pct', 'high_multiplier_pct', 'discount_amount',
    'tax_rate', 'subtotal', 'tax', 'total', 'title', 'notes', 'status',
  ])
  const updateData: Record<string, unknown> = {}
  for (const key of Object.keys(body)) {
    if (ALLOWED_FIELDS.has(key)) updateData[key] = body[key]
  }
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('estimates')
    .update(updateData)
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json(data)
}
