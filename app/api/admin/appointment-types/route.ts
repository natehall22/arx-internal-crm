import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// GET - List all appointment types for the org
export async function GET() {
  try {
    const { profile } = await requireAuthApi()
    const supabase = createServiceClient()

    const { data: appointmentTypes, error } = await supabase
      .from('appointment_types')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Error fetching appointment types:', error)
      return NextResponse.json({ error: 'Failed to fetch appointment types' }, { status: 500 })
    }

    return NextResponse.json({ appointmentTypes })
  } catch (error) {
    console.error('Appointment types GET error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// POST - Create a new appointment type
export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    
    // Only admins and managers can create appointment types
    if (!['admin', 'owner', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const body = await request.json()

    const { name, duration_minutes, buffer_after_minutes, color, description, category, active } = body

    if (!name || !duration_minutes) {
      return NextResponse.json({ error: 'Name and duration are required' }, { status: 400 })
    }

    // Get max sort order
    const { data: maxOrder } = await supabase
      .from('appointment_types')
      .select('sort_order')
      .eq('org_id', profile.org_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const sortOrder = (maxOrder?.sort_order || 0) + 1

    const { data: appointmentType, error } = await supabase
      .from('appointment_types')
      .insert({
        org_id: profile.org_id,
        name,
        duration_minutes: parseInt(duration_minutes, 10),
        color: color || '#3b82f6',
        description: description || null,
        category: category || 'inspection',
        active: active !== false,
        sort_order: sortOrder,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating appointment type:', error)
      return NextResponse.json({ error: 'Failed to create appointment type' }, { status: 500 })
    }

    return NextResponse.json({ appointmentType })
  } catch (error) {
    console.error('Appointment types POST error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// PUT - Update an appointment type
export async function PUT(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    
    if (!['admin', 'owner', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const body = await request.json()

    const { id, name, duration_minutes, buffer_after_minutes, color, description, category, active, sort_order } = body

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (duration_minutes !== undefined) updates.duration_minutes = parseInt(duration_minutes, 10)
    if (buffer_after_minutes !== undefined) {
      updates.buffer_after_minutes = Math.max(0, parseInt(String(buffer_after_minutes), 10) || 0)
    }
    if (color !== undefined) updates.color = color
    if (description !== undefined) updates.description = description
    if (category !== undefined) updates.category = category
    if (active !== undefined) updates.active = active
    if (sort_order !== undefined) updates.sort_order = sort_order

    const { data: appointmentType, error } = await supabase
      .from('appointment_types')
      .update(updates)
      .eq('id', id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (error) {
      console.error('Error updating appointment type:', error)
      return NextResponse.json({ error: 'Failed to update appointment type' }, { status: 500 })
    }

    return NextResponse.json({ appointmentType })
  } catch (error) {
    console.error('Appointment types PUT error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// DELETE - Delete an appointment type
export async function DELETE(request: NextRequest) {
  try {
    const { profile } = await requireAuthApi()
    
    if (!['admin', 'owner', 'regional_manager', 'sales_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('appointment_types')
      .delete()
      .eq('id', id)
      .eq('org_id', profile.org_id)

    if (error) {
      console.error('Error deleting appointment type:', error)
      return NextResponse.json({ error: 'Failed to delete appointment type' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Appointment types DELETE error:', error)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
