import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { authUser, profile } = await requireAuthApi()
  const serviceSupabase = createServiceClient()
  if (await resolveSalesDocAccessBarred(serviceSupabase, authUser.id, profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: repSignature } = await serviceSupabase
    .from('contract_signatures')
    .select('signed_at')
    .eq('contract_id', params.id)
    .eq('role', 'rep')
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (repSignature?.signed_at) {
    await serviceSupabase
      .from('contracts')
      .update({
        status: 'rep_signed',
        rep_signed_at: repSignature.signed_at,
      })
      .eq('id', params.id)
  }

  return NextResponse.json({ ok: true })
}
