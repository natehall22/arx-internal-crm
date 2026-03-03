import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
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
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
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

    const body = await request.json()
    const { name, email, phone, address_text } = body

    // Build update object with only provided fields
    const updateData: Record<string, any> = {}
    if (name !== undefined) updateData.name = name || null
    if (email !== undefined) updateData.email = email || null
    if (phone !== undefined) updateData.phone = phone || null
    if (address_text !== undefined) updateData.address_text = address_text || null

    // Normalize phone for search
    if (phone !== undefined) {
      updateData.normalized_phone = phone ? phone.replace(/\D/g, '') : null
    }

    // Normalize email for search
    if (email !== undefined) {
      updateData.email_lower = email ? email.toLowerCase() : null
    }

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
