import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest, getAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 403 })
    }

    const supabase = getAdminClient()

    const { data: roofingTypes, error: fetchError } = await supabase
      .from('roofing_types')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('sort_order')

    if (fetchError) {
      console.error('Error fetching roofing types:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch roofing types' }, { status: 500 })
    }

    return NextResponse.json({
      roofingTypes: roofingTypes || [],
      role: profile.role,
    })
  } catch (err) {
    console.error('Roofing types GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied. Only admins and operations managers can manage roofing types.' }, { status: 403 })
    }

    const body = await request.json()
    const supabase = getAdminClient()

    // If setting as default, unset others first
    if (body.is_default) {
      await supabase
        .from('roofing_types')
        .update({ is_default: false })
        .eq('org_id', profile.org_id)
    }

    const { data: newType, error: insertError } = await supabase
      .from('roofing_types')
      .insert({
        org_id: profile.org_id,
        name: body.name,
        description: body.description || null,
        price_per_square: parseFloat(body.price_per_square) || 350,
        material_cost_per_square: body.material_cost_per_square ? parseFloat(body.material_cost_per_square) : null,
        labor_cost_per_square: body.labor_cost_per_square ? parseFloat(body.labor_cost_per_square) : null,
        labor_multiplier: parseFloat(body.labor_multiplier) || 1.0,
        default_warranty_years: parseInt(body.default_warranty_years) || 10,
        default_warranty_text: body.default_warranty_text || null,
        color: body.color || '#4f46e5',
        sort_order: body.sort_order || 0,
        is_default: body.is_default || false,
        active: true,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error creating roofing type:', insertError)
      return NextResponse.json({ error: 'Failed to create roofing type' }, { status: 500 })
    }

    return NextResponse.json({ roofingType: newType })
  } catch (err) {
    console.error('Roofing types POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const supabase = getAdminClient()

    // If setting as default, unset others first
    if (updates.is_default) {
      await supabase
        .from('roofing_types')
        .update({ is_default: false })
        .eq('org_id', profile.org_id)
    }

    // Build update object
    const updateData: any = {}
    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.price_per_square !== undefined) updateData.price_per_square = parseFloat(updates.price_per_square)
    if (updates.material_cost_per_square !== undefined) updateData.material_cost_per_square = updates.material_cost_per_square ? parseFloat(updates.material_cost_per_square) : null
    if (updates.labor_cost_per_square !== undefined) updateData.labor_cost_per_square = updates.labor_cost_per_square ? parseFloat(updates.labor_cost_per_square) : null
    if (updates.labor_multiplier !== undefined) updateData.labor_multiplier = parseFloat(updates.labor_multiplier)
    if (updates.default_warranty_years !== undefined) updateData.default_warranty_years = parseInt(updates.default_warranty_years)
    if (updates.default_warranty_text !== undefined) updateData.default_warranty_text = updates.default_warranty_text
    if (updates.color !== undefined) updateData.color = updates.color
    if (updates.sort_order !== undefined) updateData.sort_order = updates.sort_order
    if (updates.is_default !== undefined) updateData.is_default = updates.is_default
    if (updates.active !== undefined) updateData.active = updates.active

    const { data: updated, error: updateError } = await supabase
      .from('roofing_types')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating roofing type:', updateError)
      return NextResponse.json({ error: 'Failed to update roofing type' }, { status: 500 })
    }

    return NextResponse.json({ roofingType: updated })
  } catch (err) {
    console.error('Roofing types PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const supabase = getAdminClient()

    // Soft delete - just mark as inactive
    const { error: deleteError } = await supabase
      .from('roofing_types')
      .update({ active: false })
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (deleteError) {
      console.error('Error deleting roofing type:', deleteError)
      return NextResponse.json({ error: 'Failed to delete roofing type' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Roofing types DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
