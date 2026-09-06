import { NextRequest, NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidOptionalEmail(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  return typeof value === 'string' && EMAIL_PATTERN.test(value)
}

// Fields the subs admin UI (app/admin/subs/page.tsx) legitimately edits via
// PATCH. Whitelisted to block mass-assignment: without this, `const { id,
// ...updates } = body` followed by `.update(updates)` lets a caller set ANY
// column on sub_contractors, including org_id (moving a sub to another
// tenant), portal_access_token, user_id, or a raw `active` flip outside the
// normal toggle path. Deliberately excludes id, org_id, user_id,
// portal_access_token, and created/updated audit columns.
const ALLOWED_FIELDS = new Set([
  'company_name',
  'contact_name',
  'phone',
  'email',
  'scheduling_email',
  'address',
  'city',
  'state',
  'zip',
  'license_number',
  'services',
  'internal_notes',
  'portal_access_enabled',
  'active',
])

export async function GET() {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Service client: every query in this file is explicitly scoped with
    // `.eq('org_id', profile.org_id)` rather than relying on RLS for org
    // isolation, so a service client does not widen access here — it just
    // skips a redundant anon-client round trip. This matches the rationale in
    // commit 183f45e: where the service client already did the data work and
    // the anon client existed only to call getUser(), the anon client is
    // deleted outright rather than kept "for safety."
    const supabase = createServiceClient()

    const { data: subs, error } = await supabase
      .from('sub_contractors')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('company_name')

    if (error) {
      console.error('Error fetching subs:', error)
    }

    return NextResponse.json({
      subs: subs || [],
      orgId: profile.org_id,
    })
  } catch (error) {
    console.error('Subs API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Service client — see rationale in GET above; this insert scopes org_id
    // explicitly from the caller's own profile rather than trusting RLS.
    const supabase = createServiceClient()

    const body = await request.json()

    if (!isValidOptionalEmail(body.scheduling_email)) {
      return NextResponse.json({ error: 'Scheduling email must be a valid email address' }, { status: 400 })
    }

    const subData = {
      org_id: profile.org_id,
      company_name: body.company_name,
      contact_name: body.contact_name || null,
      phone: body.phone || null,
      email: body.email || null,
      scheduling_email: body.scheduling_email || null,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
      license_number: body.license_number || null,
      services: body.services || [],
      internal_notes: body.internal_notes || null,
      portal_access_enabled: body.portal_access_enabled || false,
      active: true,
    }

    const { data, error } = await supabase
      .from('sub_contractors')
      .insert(subData)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ sub: data })
  } catch (error) {
    console.error('Subs POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminRoles = ['admin', 'regional_manager', 'operations', 'manager', 'sales_manager', 'owner']
    if (!adminRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Service client — see rationale in GET above; this update stays scoped to
    // the caller's own org via the explicit .eq('org_id', ...) below.
    const supabase = createServiceClient()

    const body = await request.json()
    const { id, ...rawUpdates } = body

    if (!id) {
      return NextResponse.json({ error: 'Sub ID required' }, { status: 400 })
    }

    // Whitelist updateable fields to prevent mass-assignment (matches the
    // guard in app/api/ops/jobs/[id]/route.ts).
    const updates: Record<string, unknown> = {}
    for (const key of Object.keys(rawUpdates)) {
      if (ALLOWED_FIELDS.has(key)) updates[key] = rawUpdates[key]
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if ('scheduling_email' in updates && !isValidOptionalEmail(updates.scheduling_email)) {
      return NextResponse.json({ error: 'Scheduling email must be a valid email address' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('sub_contractors')
      .update(updates)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ sub: data })
  } catch (error) {
    console.error('Subs PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only admin can delete
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete subcontractors' }, { status: 403 })
    }

    // Service client — see rationale in GET above; every query here is
    // explicitly scoped to the caller's own org.
    const supabase = createServiceClient()

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Sub ID required' }, { status: 400 })
    }

    // Check if sub has any assigned jobs or work orders
    const [{ data: assignedJobs }, { data: assignedWorkOrders }] = await Promise.all([
      supabase
        .from('production_jobs')
        .select('id')
        .eq('assigned_sub_id', id)
        .limit(1),
      supabase
        .from('work_orders')
        .select('id')
        .eq('sub_contractor_id', id)
        .limit(1),
    ])

    if ((assignedJobs && assignedJobs.length > 0) || (assignedWorkOrders && assignedWorkOrders.length > 0)) {
      return NextResponse.json({
        error: 'Cannot delete subcontractor with assigned jobs or work orders. Reassign or complete them first, or deactivate the sub instead.'
      }, { status: 400 })
    }

    const { error } = await supabase
      .from('sub_contractors')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Subs DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
