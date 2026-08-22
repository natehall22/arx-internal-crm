import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { syncCloserAttributionDownstream } from '@/lib/payroll-attribution-sync'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// Plain reps (rep/sales_rep/closer) may only reach an opportunity they own, set, or are the
// assigned closer on via the linked lead — same three checks the list endpoint
// (app/api/opportunities/route.ts GET) uses to scope org-wide browsing. Everyone else
// (managers, admins, and any other role) is unrestricted here, matching that same list
// endpoint's `isRep` gate: only rep/sales_rep/closer get narrowed, nobody else does today.
const REP_LIKE_ROLES = new Set(['rep', 'sales_rep', 'closer'])

async function canRepAccessOpportunity(
  adminClient: ReturnType<typeof createServiceClient>,
  profile: { role: string; org_id: string },
  userId: string,
  opportunity: { owner_user_id: string | null; setter_user_id: string | null; lead_id: string | null }
): Promise<boolean> {
  if (!REP_LIKE_ROLES.has(profile.role)) return true

  if (opportunity.owner_user_id === userId) return true
  if (opportunity.setter_user_id === userId) return true

  if (opportunity.lead_id) {
    const { data: lead } = await adminClient
      .from('leads')
      .select('closer_user_id')
      .eq('id', opportunity.lead_id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (lead?.closer_user_id === userId) return true
  }

  return false
}

// GET - Get a single opportunity
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = authContext.profile
    const adminClient = createServiceClient()
    const { data: opportunity, error } = await adminClient
      .from('opportunities')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Reps only get records they own, set, or are the assigned closer on via the lead —
    // mirrors the list endpoint's scoping (app/api/opportunities/route.ts GET) so this
    // by-id lookup can't be used to bypass the list's ownership filter. Managers/admins
    // (anyone outside this role set) are unrestricted, same as the list endpoint.
    if (!(await canRepAccessOpportunity(adminClient, profile, authContext.authUser.id, opportunity))) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    return NextResponse.json({ opportunity })
  } catch (error) {
    console.error('Opportunity GET error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch opportunity'
    }, { status: 500 })
  }
}

// PATCH - Update an opportunity
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = authContext.profile
    const adminClient = createServiceClient()
    const body = await request.json()

    const PAYROLL_ATTR_ROLES = new Set(['admin', 'owner', 'operations'])

    // Whitelist updateable fields to prevent mass-assignment of org_id, id, etc.
    const ALLOWED_FIELDS = new Set([
      'status', 'stage', 'outcome', 'notes', 'inspection_outcome', 'inspection_outcome_at',
      'inspection_notes', 'sale_amount', 'contact_name', 'contact_email', 'contact_phone',
      'address_text', 'assigned_user_id', 'closer_user_id', 'setter_user_id', 'owner_user_id',
      'job_source', 'insurance_stage',
      'insurance_company', 'claim_number', 'adjuster_name', 'adjuster_phone',
      'deductible', 'rcv', 'acv', 'profit_margin', 'contract_signed_at',
      'customer_id', 'follow_up_at', 'source', 'pipeline_stage',
    ])
    const updateData: Record<string, unknown> = {}
    for (const key of Object.keys(body)) {
      if (ALLOWED_FIELDS.has(key)) updateData[key] = body[key]
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const touchesPayrollAttribution =
      Object.prototype.hasOwnProperty.call(updateData, 'setter_user_id') ||
      Object.prototype.hasOwnProperty.call(updateData, 'owner_user_id')

    if (touchesPayrollAttribution && !PAYROLL_ATTR_ROLES.has(String(profile.role || '').toLowerCase())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: existingOpp, error: existingErr } = await adminClient
      .from('opportunities')
      .select('id, setter_user_id, owner_user_id, lead_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (existingErr || !existingOpp) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Same ownership scoping as GET: a rep can't patch an opportunity they don't own/set/close,
    // even if they somehow have the id (e.g. from a stale link or another surface).
    if (!(await canRepAccessOpportunity(adminClient, profile, authContext.authUser.id, existingOpp))) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const { data: opportunity, error } = await adminClient
      .from('opportunities')
      .update(updateData)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      console.error('Opportunity update error:', error)
      return NextResponse.json({ error: 'Failed to update opportunity' }, { status: 500 })
    }

    if (touchesPayrollAttribution && opportunity) {
      const setterChanged =
        Object.prototype.hasOwnProperty.call(updateData, 'setter_user_id') &&
        (existingOpp.setter_user_id ?? null) !== (opportunity.setter_user_id ?? null)
      const closerChanged =
        Object.prototype.hasOwnProperty.call(updateData, 'owner_user_id') &&
        (existingOpp.owner_user_id ?? null) !== (opportunity.owner_user_id ?? null)

      if (setterChanged || closerChanged) {
        const ids = [
          existingOpp.setter_user_id,
          existingOpp.owner_user_id,
          opportunity.setter_user_id,
          opportunity.owner_user_id,
        ].filter((x): x is string => typeof x === 'string')

        const nameById = new Map<string, string>()
        if (ids.length > 0) {
          const { data: usersForNames } = await adminClient
            .from('users')
            .select('id, full_name')
            .eq('org_id', profile.org_id)
            .in('id', Array.from(new Set(ids)))

          for (const u of usersForNames || []) {
            nameById.set(u.id, u.full_name || u.id)
          }
        }

        const fmt = (id: string | null | undefined) =>
          id ? nameById.get(id) || id : '—'

        const parts: string[] = []
        parts.push(`Payroll attribution updated by ${profile.full_name || authContext.authUser.id}.`)
        if (setterChanged) {
          parts.push(
            `Setter: ${fmt(existingOpp.setter_user_id)} → ${fmt(opportunity.setter_user_id)}.`
          )
        }
        if (closerChanged) {
          parts.push(
            `Closer: ${fmt(existingOpp.owner_user_id)} → ${fmt(opportunity.owner_user_id)}.`
          )
        }

        await adminClient.from('activities').insert({
          org_id: profile.org_id,
          opportunity_id: params.id,
          user_id: authContext.authUser.id,
          type: 'note',
          body: parts.join(' '),
        })
      }

      if (closerChanged) {
        await syncCloserAttributionDownstream(adminClient, {
          orgId: profile.org_id,
          closerUserId: (opportunity.owner_user_id as string | null) ?? null,
          opportunityId: params.id,
        })
      }
    }

    return NextResponse.json({ opportunity })
  } catch (error) {
    console.error('Opportunity PATCH error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update opportunity' 
    }, { status: 500 })
  }
}

// DELETE - Delete an opportunity (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let authContext: Awaited<ReturnType<typeof requireAuthApi>>
    try {
      authContext = await requireAuthApi()
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = authContext.profile
    const adminClient = createServiceClient()

    // Only admins can delete opportunities
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete opportunities' }, { status: 403 })
    }

    // First, check if the opportunity exists and belongs to the org
    const { data: opportunity, error: fetchError } = await adminClient
      .from('opportunities')
      .select('id, lead_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !opportunity) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    // Delete related records first (if any)
    // Delete proposals linked to this opportunity
    await adminClient
      .from('proposals')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete projects linked to this opportunity
    await adminClient
      .from('projects')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete activities linked to this opportunity
    await adminClient
      .from('activities')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete appointments linked to this opportunity
    await adminClient
      .from('scheduled_appointments')
      .delete()
      .eq('opportunity_id', params.id)

    // Delete roof measurements linked to this opportunity
    await adminClient
      .from('roof_measurements')
      .delete()
      .eq('opportunity_id', params.id)

    // Now delete the opportunity
    const { error: deleteError } = await adminClient
      .from('opportunities')
      .delete()
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Opportunity delete error:', deleteError)
      return NextResponse.json({ error: 'Failed to delete opportunity' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Opportunity DELETE error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete opportunity' 
    }, { status: 500 })
  }
}
