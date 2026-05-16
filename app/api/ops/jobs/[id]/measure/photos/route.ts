import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessJobBoard } from '@/lib/permissions'
import {
  exteriorMeasureErrorMessage,
  resolveJobMeasureContext,
  uploadExteriorMeasurePhoto,
} from '@/lib/exterior-measure-api'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    if (!canAccessJobBoard(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const supabase = createServiceClient()
    const context = await resolveJobMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Linked opportunity not found for job' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'File is required' }, { status: 400 })

    const photo = await uploadExteriorMeasurePhoto({
      supabase,
      context,
      userId: profile.id,
      file,
      elevationId: String(formData.get('elevation_id') || '') || null,
      openingId: String(formData.get('opening_id') || '') || null,
      caption: String(formData.get('caption') || '') || null,
    })

    return NextResponse.json({ photo })
  } catch (error: unknown) {
    console.error('Failed to upload job measure photo:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to upload measure photo') }, { status: 500 })
  }
}
