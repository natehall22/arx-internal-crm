import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canAccessCustomerRecordsFromPermissionNames, canEditCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    const customerPermissions = await resolveEffectivePermissionNames(adminClient, profile.id, profile)
    if (!canAccessCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: customer, error } = await adminClient
      .from('customers')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (error || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (isRepLikeCustomerRecordRole(profile.role)) {
      const [{ data: ownedProjects }, { data: ownedOpportunities }] = await Promise.all([
        adminClient
          .from('projects')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', params.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
        adminClient
          .from('opportunities')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', params.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
      ])
      if ((ownedProjects || []).length === 0 && (ownedOpportunities || []).length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    return NextResponse.json({ customer })

  } catch (error) {
    console.error('Error in GET /api/customers/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    let profile
    try {
      ;({ profile } = await requireAuthApi())
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createServiceClient()

    const customerPermissions = await resolveEffectivePermissionNames(adminClient, profile.id, profile)
    if (!canEditCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify customer exists and belongs to org
    const { data: existingCustomer, error: fetchError } = await adminClient
      .from('customers')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (fetchError || !existingCustomer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (isRepLikeCustomerRecordRole(profile.role)) {
      const [{ data: ownedProjects }, { data: ownedOpportunities }] = await Promise.all([
        adminClient
          .from('projects')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', params.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
        adminClient
          .from('opportunities')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', params.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
      ])
      if ((ownedProjects || []).length === 0 && (ownedOpportunities || []).length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const body = await request.json()
    const { name, email, phone, address_text } = body

    // Build update object with only provided fields
    // Note: phone_normalized and email_lower are GENERATED columns - they update automatically
    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name || null
    if (email !== undefined) updateData.email = email || null
    if (phone !== undefined) updateData.phone = phone || null
    if (address_text !== undefined) updateData.address_text = address_text || null

    const { data: customer, error: updateError } = await adminClient
      .from('customers')
      .update(updateData)
      .eq('id', params.id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating customer:', updateError)
      return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }

    return NextResponse.json({ customer })

  } catch (error) {
    console.error('Error in PATCH /api/customers/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
