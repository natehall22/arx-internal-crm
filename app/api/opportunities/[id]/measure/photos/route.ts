import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  canAccessOpportunityMeasure,
  exteriorMeasureErrorMessage,
  resolveOpportunityMeasureContext,
  uploadExteriorMeasurePhoto,
} from '@/lib/exterior-measure-api'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const context = await resolveOpportunityMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    if (!canAccessOpportunityMeasure(profile, context.subject)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
    console.error('Failed to upload opportunity measure photo:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to upload measure photo') }, { status: 500 })
  }
}
