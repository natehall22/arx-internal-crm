import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      return JSON.parse(singleCookie.value)
    } catch {
      return null
    }
  }
  
  const chunks: string[] = []
  let i = 0
  while (true) {
    const chunk = req.cookies.get(`${cookieName}.${i}`)
    if (!chunk?.value) break
    chunks.push(chunk.value)
    i++
  }
  
  if (chunks.length > 0) {
    try {
      return JSON.parse(chunks.join(''))
    } catch {
      return null
    }
  }
  
  return null
}

function getAuthClient(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sessionData = getSessionFromRequest(req)
  
  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: sessionData?.access_token
        ? { headers: { Authorization: `Bearer ${sessionData.access_token}` } }
        : undefined,
    }),
    accessToken: sessionData?.access_token,
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(request: NextRequest) {
  try {
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager', 'manager', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Load pricebook items
    const { data: items } = await adminClient
      .from('pricebook_items')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('category')
      .order('name')

    // Load templates
    const { data: templates } = await adminClient
      .from('proposal_templates')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('name')

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
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, data } = body

    if (type === 'adder') {
      // Get default pricebook
      const { data: pricebook } = await adminClient
        .from('pricebooks')
        .select('id')
        .eq('org_id', profile.org_id)
        .eq('is_default', true)
        .single()

      // Determine commission settings based on the new logic:
      // - is_commissionable=true with no percent/cap = flows through regular comp plan (commission_percent=null)
      // - is_commissionable=true with percent/cap = custom commission (does NOT flow through comp plan)
      // - is_commissionable=false = no commission at all
      let commissionPercent = null
      let commissionCap = null
      
      if (data.is_commissionable) {
        // Only set commission_percent if custom values were provided
        if (data.commission_percent) {
          commissionPercent = parseFloat(data.commission_percent)
        }
        if (data.commission_cap) {
          commissionCap = parseFloat(data.commission_cap)
        }
      }

      // Build insert object - only include optional fields if they have values
      const insertData: any = {
        org_id: profile.org_id,
        pricebook_id: pricebook?.id,
        name: data.name,
        category: data.category || 'Other',
        unit: data.price_type === 'percentage' ? 'percent' : (data.unit || 'each'),
        unit_price: parseFloat(data.unit_price) || 0,
        is_adder: true,
        adder_category: data.adder_category || 'Other',
        price_type: data.price_type || 'fixed',
        is_commissionable: data.is_commissionable ?? true,
        visibility: 'sales_reps',
        active: true,
      }

      // Add optional cost fields if they have values
      if (data.material_cost || data.labor_cost) {
        insertData.cost_price = (parseFloat(data.material_cost) || 0) + (parseFloat(data.labor_cost) || 0)
      }
      if (data.material_cost) {
        insertData.material_cost = parseFloat(data.material_cost)
      }
      if (data.labor_cost) {
        insertData.labor_cost = parseFloat(data.labor_cost)
      }
      if (data.profit_margin_percent) {
        insertData.profit_margin_percent = parseFloat(data.profit_margin_percent)
      }
      if (commissionPercent !== null) {
        insertData.commission_percent = commissionPercent
      }
      if (commissionCap !== null) {
        insertData.commission_cap = commissionCap
      }

      const { data: newAdder, error: adderError } = await adminClient
        .from('pricebook_items')
        .insert(insertData)
        .select()
        .single()

      if (adderError) {
        console.error('Error creating adder:', adderError)
        return NextResponse.json({ error: `Failed to create adder: ${adderError.message}` }, { status: 500 })
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
        const { data: updated, error: updateError } = await adminClient
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
          await adminClient
            .from('proposal_templates')
            .update({ is_default: false })
            .eq('org_id', profile.org_id)
            .neq('id', data.id)
        }

        return NextResponse.json({ template: updated })
      } else {
        // Create new
        const { data: newTemplate, error: createError } = await adminClient
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
          await adminClient
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
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const body = await request.json()
    const { type, id, data } = body

    if (type === 'visibility') {
      const { error: updateError } = await adminClient
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
      const { error: updateError } = await adminClient
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
    const { client: authClient, accessToken } = getAuthClient(request)
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: { user }, error: userError } = await authClient.auth.getUser(accessToken)
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = getAdminClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'regional_manager', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const id = searchParams.get('id')

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing type or id' }, { status: 400 })
    }

    if (type === 'adder') {
      const { error: deleteError } = await adminClient
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
      const { error: deleteError } = await adminClient
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
