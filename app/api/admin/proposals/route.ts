import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest, getAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'regional_manager', 'manager', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const supabase = getAdminClient()

    // Load pricebook items
    const { data: items, error: itemsError } = await supabase
      .from('pricebook_items')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('category')
      .order('name')

    if (itemsError) {
      console.error('Error loading pricebook items:', itemsError)
    }

    // Load templates
    const { data: templates, error: templatesError } = await supabase
      .from('proposal_templates')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('name')

    if (templatesError) {
      console.error('Error loading templates:', templatesError)
    }

    return NextResponse.json({
      pricebookItems: items || [],
      templates: templates || [],
      orgId: profile.org_id,
      role: profile.role,
    })
  } catch (err) {
    console.error('Admin proposals GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, data } = body

    const supabase = getAdminClient()

    if (type === 'adder') {
      // Get default pricebook
      const { data: pricebook } = await supabase
        .from('pricebooks')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .single()

      const { data: newAdder, error: adderError } = await supabase
        .from('pricebook_items')
        .insert({
          org_id: profile.org_id,
          pricebook_id: pricebook?.id,
          name: data.name,
          category: data.category,
          unit: data.price_type === 'percentage' ? 'percent' : data.unit,
          unit_price: parseFloat(data.unit_price) || 0,
          is_adder: true,
          adder_category: data.adder_category,
          price_type: data.price_type,
          is_commissionable: data.is_commissionable,
          commission_percent: data.is_commissionable ? (parseFloat(data.commission_percent) || 100) : null,
          commission_cap: data.is_commissionable && data.commission_cap ? parseFloat(data.commission_cap) : null,
          visibility: 'sales_reps',
          active: true,
        })
        .select()
        .single()

      if (adderError) {
        console.error('Error creating adder:', adderError)
        return NextResponse.json({ error: 'Failed to create adder' }, { status: 500 })
      }

      return NextResponse.json({ adder: newAdder })
    }

    if (type === 'template') {
      const templateData = {
        org_id: profile.org_id,
        name: data.name,
        description: data.description,
        accent_color: data.accent_color,
        default_scope_of_work: data.default_scope_of_work,
        default_warranty_info: data.default_warranty_info,
        default_terms_conditions: data.default_terms_conditions,
        is_default: data.is_default,
        active: true,
      }

      if (data.id) {
        // Update existing
        const { data: updated, error: updateError } = await supabase
          .from('proposal_templates')
          .update(templateData)
          .eq('id', data.id)
          .select()
          .single()

        if (updateError) {
          console.error('Error updating template:', updateError)
          return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
        }

        // If setting as default, unset others
        if (data.is_default) {
          await supabase
            .from('proposal_templates')
            .update({ is_default: false })
            .eq('org_id', profile.org_id)
            .neq('id', data.id)
        }

        return NextResponse.json({ template: updated })
      } else {
        // Create new
        const { data: newTemplate, error: createError } = await supabase
          .from('proposal_templates')
          .insert(templateData)
          .select()
          .single()

        if (createError) {
          console.error('Error creating template:', createError)
          return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
        }

        // If setting as default, unset others
        if (data.is_default && newTemplate) {
          await supabase
            .from('proposal_templates')
            .update({ is_default: false })
            .eq('org_id', profile.org_id)
            .neq('id', newTemplate.id)
        }

        return NextResponse.json({ template: newTemplate })
      }
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('Admin proposals POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, id, data } = body

    const supabase = getAdminClient()

    if (type === 'visibility') {
      const { error: updateError } = await supabase
        .from('pricebook_items')
        .update({ visibility: data.visibility })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (updateError) {
        console.error('Error updating visibility:', updateError)
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (type === 'toggle_adder') {
      const { error: updateError } = await supabase
        .from('pricebook_items')
        .update({ is_adder: data.is_adder })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (updateError) {
        console.error('Error toggling adder:', updateError)
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('Admin proposals PATCH error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { session, profile, error } = await getSessionFromRequest(request)
    
    if (error || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const id = searchParams.get('id')

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing type or id' }, { status: 400 })
    }

    const supabase = getAdminClient()

    if (type === 'adder') {
      const { error: deleteError } = await supabase
        .from('pricebook_items')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (deleteError) {
        console.error('Error deleting adder:', deleteError)
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    if (type === 'template') {
      const { error: deleteError } = await supabase
        .from('proposal_templates')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (deleteError) {
        console.error('Error deleting template:', deleteError)
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('Admin proposals DELETE error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
