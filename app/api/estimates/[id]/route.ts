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

  const { data, error } = await supabase
    .from('estimates')
    .update(body)
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json(data)
}
