import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import {
  canAccessOpportunityMeasure,
  exteriorMeasureErrorMessage,
  loadExteriorMeasure,
  resolveOpportunityMeasureContext,
  saveExteriorMeasure,
} from '@/lib/exterior-measure-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const context = await resolveOpportunityMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    if (!canAccessOpportunityMeasure(profile, context.subject)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const measure = await loadExteriorMeasure(supabase, context)
    return NextResponse.json({ subject: context.subject, context, ...measure })
  } catch (error: unknown) {
    console.error('Failed to load opportunity measure report:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to load measure report') }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile, authUser } = await requireAuthApi()
    const supabase = createServiceClient()
    const context = await resolveOpportunityMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    if (!canAccessOpportunityMeasure(profile, context.subject)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const measure = await saveExteriorMeasure({ supabase, context, authUserId: authUser.id, body })
    return NextResponse.json({ subject: context.subject, context, ...measure })
  } catch (error: unknown) {
    console.error('Failed to save opportunity measure report:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to save measure report') }, { status: 500 })
  }
}
