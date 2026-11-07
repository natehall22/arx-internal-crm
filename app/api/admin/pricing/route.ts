import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { stripPricebookCosts } from '@/lib/pricebook-costs'
import { canSeeFinancials } from '@/lib/financials-access'
import { mergeOrgSettings } from '@/lib/org-settings'

export const dynamic = 'force-dynamic'

// Body fields an edit may change. Never id, org_id or pricebook_id (security audit C2, 2026-11-07).
const PRICEBOOK_EDITABLE = ['name'] as const
const PRICEBOOK_ITEM_EDITABLE = [
  'category', 'item_type', 'name', 'unit', 'unit_price', 'cost_price', 'is_labor', 'is_taxable', 'active',
  'price_type', 'is_commissionable', 'commission_percent', 'commission_cap', 'material_cost', 'labor_cost',
  'profit_margin_percent',
] as const

function pickEditable(data: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in data) out[k] = data[k]
  return out
}

function getSessionFromRequest(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] || ''
  const cookieName = `sb-${projectRef}-auth-token`
  
  const singleCookie = req.cookies.get(cookieName)
  if (singleCookie?.value) {
    try {
      const decoded = decodeURIComponent(singleCookie.value)
      return JSON.parse(decoded)
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
      const decoded = decodeURIComponent(chunks.join(''))
      return JSON.parse(decoded)
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

// GET - Get pricing data (pricebooks, items, org settings)
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

    const adminClient = createServiceClient()

    // Get user profile
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Check admin/ops access - only admin and operations managers can view cost data
    if (!['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied. Only admins and operations managers can access pricing and cost data.' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const pricebookId = searchParams.get('pricebook_id')

    // Get pricebooks
    let { data: pricebooks } = await adminClient
      .from('pricebooks')
      .select('*')
      .eq('org_id', profile.org_id)
      .order('is_default', { ascending: false })
      .order('name')

    // Auto-create default pricebook if none exists
    if (!pricebooks || pricebooks.length === 0) {
      const { data: newPricebook } = await adminClient
        .from('pricebooks')
        .insert({
          org_id: profile.org_id,
          name: 'Default Pricebook',
          is_default: true,
        })
        .select()
        .single()
      
      if (newPricebook) {
        pricebooks = [newPricebook]
      }
    }

    // Get items for specific pricebook if requested
    let items: any[] = []
    if (pricebookId) {
      const { data: itemsData } = await adminClient
        .from('pricebook_items')
        .select('*')
        .eq('pricebook_id', pricebookId)
        .order('category')
        .order('name')
      items = itemsData || []
    } else if (pricebooks && pricebooks.length > 0) {
      // Get items for default pricebook
      const defaultPb = pricebooks.find(p => p.is_default) || pricebooks[0]
      const { data: itemsData } = await adminClient
        .from('pricebook_items')
        .select('*')
        .eq('pricebook_id', defaultPb.id)
        .order('category')
        .order('name')
      items = itemsData || []
    }

    // Cost / margin columns need reports:financials (lib/pricebook-costs.ts); the editor still lists prices for operations.
    items = stripPricebookCosts(items, await canSeeFinancials(adminClient, { id: user.id, role: profile.role, custom_role_id: (profile as { custom_role_id?: string | null }).custom_role_id }))

    // Get org settings
    const { data: org } = await adminClient
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    return NextResponse.json({
      orgId: profile.org_id,
      pricebooks: pricebooks || [],
      items,
      orgSettings: org?.settings || {},
    })
  } catch (error) {
    console.error('Pricing API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch pricing data' 
    }, { status: 500 })
  }
}

// POST - Create pricebook or item
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

    const adminClient = createServiceClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied. Only admins and operations managers can modify pricing data.' }, { status: 403 })
    }

    const body = await request.json()
    const { type, ...data } = body

    if (type === 'pricebook') {
      const isFirst = await adminClient
        .from('pricebooks')
        .select('id')
        .eq('org_id', profile.org_id)
        .limit(1)

      const { data: pricebook, error } = await adminClient
        .from('pricebooks')
        .insert({
          org_id: profile.org_id,
          name: data.name,
          is_default: !isFirst.data?.length,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ pricebook })
    }

    if (type === 'item') {
      const { data: pricebook } = await adminClient
        .from('pricebooks')
        .select('id')
        .eq('id', data.pricebook_id)
        .eq('org_id', profile.org_id)
        .maybeSingle()
      if (!pricebook) {
        return NextResponse.json({ error: 'Pricebook not found' }, { status: 404 })
      }

      const { data: item, error } = await adminClient
        .from('pricebook_items')
        .insert({
          pricebook_id: data.pricebook_id,
          org_id: profile.org_id,
          category: data.category,
          item_type: data.item_type,
          name: data.name,
          unit: data.unit,
          unit_price: data.unit_price,
          cost_price: data.cost_price || null,
          is_labor: data.is_labor || false,
          is_taxable: data.is_taxable !== false,
          active: true,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ item })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Pricing API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create' 
    }, { status: 500 })
  }
}

// PATCH - Update pricebook, item, or org settings
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

    const adminClient = createServiceClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied. Only admins and operations managers can modify pricing data.' }, { status: 403 })
    }

    const body = await request.json()
    const { type, id, ...data } = body

    if (type === 'pricebook') {
      const updates = pickEditable(data, PRICEBOOK_EDITABLE)
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
      }
      const { error } = await adminClient
        .from('pricebooks')
        .update(updates)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'pricebook_default') {
      // Unset all defaults
      await adminClient
        .from('pricebooks')
        .update({ is_default: false })
        .eq('org_id', profile.org_id)

      // Set new default
      const { error } = await adminClient
        .from('pricebooks')
        .update({ is_default: true })
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'item') {
      const updates = pickEditable(data, PRICEBOOK_ITEM_EDITABLE)
      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
      }
      const { error } = await adminClient
        .from('pricebook_items')
        .update(updates)
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'org_settings') {
      // Only the `pricing` key: the body used to be spread over every org setting (incl. super-admin-only brand).
      if (data.pricing === undefined) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
      }
      const { error } = await mergeOrgSettings(adminClient, profile.org_id, { pricing: data.pricing })

      if (error) {
        return NextResponse.json({ error: 'Failed to save pricing settings' }, { status: 400 })
      }

      // Auto-create/update default pricebook items based on pricing settings
      if (data.pricing) {
        const pricing = data.pricing
        
        // Get or create default pricebook
        let { data: defaultPricebook } = await adminClient
          .from('pricebooks')
          .select('id')
          .eq('org_id', profile.org_id)
          .eq('is_default', true)
          .single()

        if (!defaultPricebook) {
          const { data: newPb } = await adminClient
            .from('pricebooks')
            .insert({
              org_id: profile.org_id,
              name: 'Default Pricebook',
              is_default: true,
            })
            .select()
            .single()
          defaultPricebook = newPb
        }

        if (defaultPricebook) {
          // Create/update roofing installation item if price_per_square_installed is set
          if (pricing.price_per_square_installed) {
            const { data: existingRoofing } = await adminClient
              .from('pricebook_items')
              .select('id')
              .eq('pricebook_id', defaultPricebook.id)
              .eq('name', 'Roofing Installation (Complete)')
              .single()

            if (existingRoofing) {
              await adminClient
                .from('pricebook_items')
                .update({ unit_price: pricing.price_per_square_installed })
                .eq('id', existingRoofing.id)
            } else {
              await adminClient
                .from('pricebook_items')
                .insert({
                  pricebook_id: defaultPricebook.id,
                  org_id: profile.org_id,
                  category: 'Roofing',
                  item_type: 'install',
                  name: 'Roofing Installation (Complete)',
                  unit: 'square',
                  unit_price: pricing.price_per_square_installed,
                  is_labor: false,
                  is_taxable: true,
                  active: true,
                })
            }
          }

          // Create/update solar installation item if price_per_watt is set
          if (pricing.price_per_watt) {
            const { data: existingSolar } = await adminClient
              .from('pricebook_items')
              .select('id')
              .eq('pricebook_id', defaultPricebook.id)
              .eq('name', 'Solar Installation (Complete)')
              .single()

            if (existingSolar) {
              await adminClient
                .from('pricebook_items')
                .update({ unit_price: pricing.price_per_watt })
                .eq('id', existingSolar.id)
            } else {
              await adminClient
                .from('pricebook_items')
                .insert({
                  pricebook_id: defaultPricebook.id,
                  org_id: profile.org_id,
                  category: 'Solar',
                  item_type: 'install',
                  name: 'Solar Installation (Complete)',
                  unit: 'watt',
                  unit_price: pricing.price_per_watt,
                  is_labor: false,
                  is_taxable: true,
                  active: true,
                })
            }
          }
        }
      }

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Pricing API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to update' 
    }, { status: 500 })
  }
}

// DELETE - Delete pricebook or item
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

    const adminClient = createServiceClient()

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id || !['admin', 'operations'].includes(profile.role)) {
      return NextResponse.json({ error: 'Access denied. Only admins and operations managers can delete pricing data.' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type')
    const id = searchParams.get('id')

    if (!type || !id) {
      return NextResponse.json({ error: 'Missing type or id' }, { status: 400 })
    }

    if (type === 'pricebook') {
      const { error } = await adminClient
        .from('pricebooks')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    if (type === 'item') {
      const { error } = await adminClient
        .from('pricebook_items')
        .delete()
        .eq('id', id)
        .eq('org_id', profile.org_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Pricing API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to delete' 
    }, { status: 500 })
  }
}
