import { requireAuthApi } from '@/lib/auth'
import { signFilesObject } from '@/lib/files/files-object'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  let authUser: Awaited<ReturnType<typeof requireAuthApi>>['authUser']
  let profile: Awaited<ReturnType<typeof requireAuthApi>>['profile']
  try {
    ;({ authUser, profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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

  const signedUrl = await signFilesObject(serviceSupabase, contract.contract_pdf_path, 3600)
  if (!signedUrl) {
    return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
  }

  return NextResponse.redirect(signedUrl, { status: 302 })
}
