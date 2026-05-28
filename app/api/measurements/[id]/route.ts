import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAuthApi } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET — load a saved roof measurement (raw_data + facets for map restore)
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()
    const { id } = params

    const { data: row, error: fetchError } = await adminClient
      .from('roof_measurements')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !row) {
      return NextResponse.json({ error: 'Measurement not found' }, { status: 404 })
    }

    if (row.org_id !== authContext.profile.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({ measurement: row })
  } catch (error) {
    console.error('GET /api/measurements/[id] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch measurement' },
      { status: 500 }
    )
  }
}

// DELETE — remove a roof measurement (roof_facets cascade)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()
    const { id } = params

    const { data: row, error: fetchError } = await adminClient
      .from('roof_measurements')
      .select('id, org_id')
      .eq('id', id)
      .maybeSingle()

    if (fetchError || !row) {
      return NextResponse.json({ error: 'Measurement not found' }, { status: 404 })
    }

    if (row.org_id !== authContext.profile.org_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: deleteError } = await adminClient.from('roof_measurements').delete().eq('id', id)

    if (deleteError) {
      console.error('Roof measurement delete error:', deleteError)
      return NextResponse.json(
        { error: deleteError.message || 'Failed to delete measurement' },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/measurements/[id] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete measurement' },
      { status: 500 }
    )
  }
}
