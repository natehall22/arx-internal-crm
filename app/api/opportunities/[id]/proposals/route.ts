import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuthApi } from '@/lib/auth'
import { effectiveHasPermission, resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'

export const dynamic = 'force-dynamic'

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * GET /api/opportunities/:id/proposals
 * Used by the ARX Sales iOS app (Bearer auth). Returns proposals linked to the opportunity.
 */
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

    const adminClient = getAdminClient()
    const profile = authContext.profile
    const effective = await resolveEffectivePermissionNames(
      adminClient,
      authContext.authUser.id,
      { role: profile.role, custom_role_id: profile.custom_role_id ?? null }
    )
    if (!effectiveHasPermission(effective, 'opportunities:view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (await resolveSalesDocAccessBarred(adminClient, authContext.authUser.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const opportunityId = params.id

    const { data: opportunity, error: oppError } = await adminClient
      .from('opportunities')
      .select('id')
      .eq('id', opportunityId)
      .eq('org_id', authContext.profile.org_id)
      .maybeSingle()

    if (oppError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const { data: rows, error: proposalsError } = await adminClient
      .from('proposals')
      .select('id, proposal_number, status, title, total, created_at')
      .eq('opportunity_id', opportunityId)
      .eq('org_id', authContext.profile.org_id)
      .order('created_at', { ascending: false })

    if (proposalsError) {
      console.error('Opportunity proposals fetch error:', proposalsError)
      return NextResponse.json(
        { error: proposalsError.message || 'Failed to fetch proposals' },
        { status: 500 }
      )
    }

    // iOS `Proposal` decodes `total_price`; DB column is `total`
    const proposals = (rows ?? []).map((p) => ({
      id: p.id as string,
      proposal_number: p.proposal_number as string | null,
      status: p.status as string | null,
      title: p.title as string | null,
      total_price: p.total != null ? Number(p.total) : null,
      created_at: p.created_at as string | null,
    }))

    return NextResponse.json({ proposals })
  } catch (error) {
    console.error('Opportunity proposals API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch proposals' },
      { status: 500 }
    )
  }
}
