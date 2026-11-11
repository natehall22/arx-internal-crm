import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { geocodeAddressToLatLng } from '@/lib/lead-map-pin'
import { canEditCustomerRecordsFromPermissionNames, isRepLikeCustomerRecordRole } from '@/lib/permissions'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { loadProperty } from '@/lib/properties-db'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const customerPermissions = await resolveEffectivePermissionNames(supabase, profile.id, profile)
    if (!canEditCustomerRecordsFromPermissionNames(customerPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, email, phone, address_text')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()

    if (customerError) {
      console.error('Add-on opportunity customer lookup failed:', customerError)
      return NextResponse.json({ error: 'Failed to load customer' }, { status: 500 })
    }

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    if (isRepLikeCustomerRecordRole(profile.role)) {
      const [{ data: ownedProjects }, { data: ownedOpportunities }] = await Promise.all([
        supabase
          .from('projects')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', customer.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
        supabase
          .from('opportunities')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('customer_id', customer.id)
          .eq('owner_user_id', profile.id)
          .limit(1),
      ])

      if ((ownedProjects || []).length === 0 && (ownedOpportunities || []).length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Optional property picked in the Customer File (lib/properties.ts). It must be one of THIS customer's active
    // properties; the deal then uses its address. Without one, the address comes from the customer's latest deal as before
    // (and the database fills property_id from that address — migration 202611110010).
    const body = (await request.json().catch(() => null)) as { propertyId?: unknown } | null
    let pickedProperty: Awaited<ReturnType<typeof loadProperty>> = null
    if (body?.propertyId != null) {
      pickedProperty = typeof body.propertyId === 'string' ? await loadProperty(supabase, profile.org_id, body.propertyId, false) : null
      if (!pickedProperty || pickedProperty.customer_id !== customer.id || !pickedProperty.active) {
        return NextResponse.json({ error: 'Pick one of this customer’s properties' }, { status: 400 })
      }
    }

    const [{ data: priorOpportunities }, { data: priorProjects }] = await Promise.all([
      supabase
        .from('opportunities')
        .select('address_text, lat, lng, updated_at')
        .eq('org_id', profile.org_id)
        .eq('customer_id', customer.id)
        .order('updated_at', { ascending: false })
        .limit(5),
      supabase
        .from('projects')
        .select('address_text, lat, lng, updated_at')
        .eq('org_id', profile.org_id)
        .eq('customer_id', customer.id)
        .order('updated_at', { ascending: false })
        .limit(5),
    ])

    const candidateLocations = [...(priorOpportunities || []), ...(priorProjects || [])].sort((a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0
      return bTime - aTime
    })
    // null/'' are "no coordinates" (Number(null) is 0, which used to put the new deal at 0,0).
    const coord = (v: unknown) => (v === null || v === undefined || v === '' ? NaN : Number(v))
    const hasCoords = (row: { lat?: unknown; lng?: unknown }) =>
      Number.isFinite(coord(row.lat)) && Number.isFinite(coord(row.lng))

    const sourceLocation = pickedProperty
      ? { address_text: pickedProperty.address_text, lat: pickedProperty.lat, lng: pickedProperty.lng }
      : candidateLocations.find(hasCoords) ||
        candidateLocations.find((row) => row.address_text) ||
        null
    const opportunityAddress = sourceLocation?.address_text || customer.address_text || null
    const opportunityLat = coord(sourceLocation?.lat)
    const opportunityLng = coord(sourceLocation?.lng)
    const hasSourceCoordinates = Number.isFinite(opportunityLat) && Number.isFinite(opportunityLng)
    const geocodedCoords =
      !hasSourceCoordinates && opportunityAddress ? await geocodeAddressToLatLng(opportunityAddress) : null

    const now = new Date().toISOString()
    const { data: opportunity, error: insertError } = await supabase
      .from('opportunities')
      .insert({
        org_id: profile.org_id,
        customer_id: customer.id,
        lead_id: null,
        owner_user_id: profile.id,
        status: 'open',
        project_type: 'roofing',
        address_text: opportunityAddress,
        lat: hasSourceCoordinates ? opportunityLat : geocodedCoords?.lat ?? null,
        lng: hasSourceCoordinates ? opportunityLng : geocodedCoords?.lng ?? null,
        ...(pickedProperty ? { property_id: pickedProperty.id } : {}),
        notes: `Add-on opportunity created from customer file on ${new Date(now).toLocaleDateString()}. Use this for new post-completion scope with a separate proposal and Installation Agreement.`,
      })
      .select('id')
      .single()

    if (insertError || !opportunity?.id) {
      console.error('Add-on opportunity insert failed:', insertError)
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create add-on opportunity' },
        { status: 500 }
      )
    }

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      customer_id: customer.id,
      opportunity_id: opportunity.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Add-on opportunity created for new post-completion scope.',
    })

    revalidatePath(`/customers/${customer.id}`)
    revalidatePath(`/customers/${customer.id}?tab=opportunities`)
    revalidatePath('/opportunities')

    return NextResponse.json({
      success: true,
      opportunity_id: opportunity.id,
    })
  } catch (error) {
    console.error('POST /api/customers/[id]/add-on-opportunity', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message === 'Unauthorized' || message === 'Account disabled' ? 401 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
