import { requireAuthApi } from '@/lib/auth'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { authUser, profile } = await requireAuthApi()
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, authUser.id, profile)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  const { data: contract } = await supabase
    .from('contracts')
    .select('id, contract_pdf_path, project_id')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)
    .single()

  if (!contract?.contract_pdf_path) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  }

  const { data: urlData, error } = await serviceSupabase.storage
    .from('files')
    .createSignedUrl(contract.contract_pdf_path, 3600)

  if (error || !urlData) {
    return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
  }

  return NextResponse.redirect(urlData.signedUrl, { status: 302 })
}
