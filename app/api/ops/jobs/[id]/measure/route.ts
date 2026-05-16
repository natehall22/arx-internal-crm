import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessJobBoard } from '@/lib/permissions'
import {
  exteriorMeasureErrorMessage,
  loadExteriorMeasure,
  resolveJobMeasureContext,
  saveExteriorMeasure,
} from '@/lib/exterior-measure-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile } = await requireAuthApi()
    if (!canAccessJobBoard(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const supabase = createServiceClient()
    const context = await resolveJobMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Linked opportunity not found for job' }, { status: 404 })

    const measure = await loadExteriorMeasure(supabase, context)
    return NextResponse.json({ subject: context.subject, context, ...measure })
  } catch (error: unknown) {
    console.error('Failed to load job measure report:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to load measure report') }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const { profile, authUser } = await requireAuthApi()
    if (!canAccessJobBoard(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const supabase = createServiceClient()
    const context = await resolveJobMeasureContext(supabase, profile.org_id, params.id)
    if (!context) return NextResponse.json({ error: 'Linked opportunity not found for job' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const measure = await saveExteriorMeasure({ supabase, context, authUserId: authUser.id, body })
    return NextResponse.json({ subject: context.subject, context, ...measure })
  } catch (error: unknown) {
    console.error('Failed to save job measure report:', error)
    return NextResponse.json({ error: exteriorMeasureErrorMessage(error, 'Failed to save measure report') }, { status: 500 })
  }
}
