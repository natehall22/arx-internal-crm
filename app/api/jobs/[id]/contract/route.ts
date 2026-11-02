import { requireAuthApi } from '@/lib/auth'
import { signFilesObject } from '@/lib/files/files-object'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { NextResponse } from 'next/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  let profile: Awaited<ReturnType<typeof requireAuthApi>>['profile']
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createClient()
  const serviceSupabase = createServiceClient()

  let projectQuery = supabase
    .from('projects')
    .select('id, contract_pdf_path, owner_user_id')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    projectQuery = projectQuery.eq('owner_user_id', profile.id)
  }

  const { data: project } = await projectQuery.single()

  if (!project?.contract_pdf_path) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
  }

  const signedUrl = await signFilesObject(serviceSupabase, project.contract_pdf_path, 3600)
  if (!signedUrl) {
    return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
  }

  return NextResponse.redirect(signedUrl, { status: 302 })
}
