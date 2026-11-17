import { NextResponse } from 'next/server'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { canEditCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { loadCustomerForCaller } from '@/lib/customer-file/customer-read'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { withoutCustomFields } from '@/lib/custom-fields'
import { CATEGORIES_NOT_READY, setCustomerCategory } from '@/lib/categories-db'
import { enqueueCustomerUpserted } from '@/lib/integrations'
import { createQbLinks } from '@/lib/quickbooks/links'

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

    const read = await loadCustomerForCaller(adminClient, profile, params.id)
    if (!read.ok) {
      return NextResponse.json({ error: read.status === 404 ? 'Customer not found' : 'Forbidden' }, { status: read.status })
    }
    const customer = read.customer

    // Custom field values only travel through the Customer File cards (field-role rule there).
    return NextResponse.json({ customer: withoutCustomFields(customer) })

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

    // Work category (Residential / Commercial / …): its own validated writer; '' or null clears it.
    if ('category' in body) {
      const c = await setCustomerCategory(adminClient, profile.org_id, params.id, body.category)
      if (!c.ok) return NextResponse.json({ error: c.status === 503 ? CATEGORIES_NOT_READY : c.error }, { status: c.status })
      if (Object.keys(updateData).length === 0) {
        const { data: fresh } = await adminClient.from('customers').select('*').eq('id', params.id).eq('org_id', profile.org_id).single()
        return NextResponse.json({ customer: fresh })
      }
    }

    const { data: customer, error: updateError } = await adminClient
      .from('customers')
      .update(updateData)
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating customer:', updateError)
      return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
    }

    // Edited from a deal's file with "also update this deal's address": the linked lead's copy follows only if it still holds the
    // old value (equality guard, so a lead someone changed on purpose is left alone) and the lead really belongs to this customer's deal.
    const alsoLead = body.also_lead as { lead_id?: unknown; old_address?: unknown } | undefined
    if (alsoLead && typeof alsoLead.lead_id === 'string' && typeof alsoLead.old_address === 'string' && alsoLead.old_address && updateData.address_text) {
      const { data: link } = await adminClient
        .from('opportunities')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('customer_id', params.id)
        .eq('lead_id', alsoLead.lead_id)
        .limit(1)
        .maybeSingle()
      if (link) {
        await adminClient.from('leads').update({ address_text: updateData.address_text }).eq('id', alsoLead.lead_id).eq('org_id', profile.org_id).eq('address_text', alsoLead.old_address)
      }
    }

    // QuickBooks: a customer already sent there (a qb_links row exists, i.e. signed and synced) gets its edit re-queued. Anyone else is
    // not in QuickBooks yet, so nothing is queued. The helper itself checks the company's QuickBooks switch and plan and never throws.
    if (['name', 'email', 'phone', 'address_text'].some((k) => k in updateData)) {
      try {
        const sent = await createQbLinks(adminClient, profile.org_id).get('customers', params.id, 'Customer')
        if (sent) await enqueueCustomerUpserted(adminClient, profile.org_id, params.id, customer as Record<string, unknown>)
      } catch (e) {
        console.error('QuickBooks customer re-queue failed (customer saved):', e)
      }
    }

    return NextResponse.json({ customer })

  } catch (error) {
    console.error('Error in PATCH /api/customers/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
