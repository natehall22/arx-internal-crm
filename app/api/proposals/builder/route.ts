import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100

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

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET - Load builder data (pricebook items, templates, opportunity, measurement)
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

    // Get user profile for org_id and role
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const searchParams = request.nextUrl.searchParams
    const opportunityId = searchParams.get('opportunity_id')
    const measurementId = searchParams.get('measurement_id')

    // Load pricebook items
    const { data: items } = await adminClient
      .from('pricebook_items')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('category')
      .order('name')

    // Filter based on visibility
    const visibleItems = (items || []).filter((item: any) => {
      if (!item.visibility || item.visibility === 'all' || item.visibility === 'sales_reps') return true
      if (item.visibility === 'managers' && ['admin', 'regional_manager', 'sales_manager'].includes(profile.role)) return true
      if (item.visibility === 'admin_only' && profile.role === 'admin') return true
      return false
    })

    // Load templates
    const { data: templates } = await adminClient
      .from('proposal_templates')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)

    // Load org pricing settings (for default pricing)
    const { data: org } = await adminClient
      .from('orgs')
      .select('settings')
      .eq('id', profile.org_id)
      .single()

    const orgPricing = org?.settings?.pricing || {}

    // Load opportunity data if provided
    let opportunity = null
    if (opportunityId) {
      const { data: opp } = await adminClient
        .from('opportunities')
        .select('*, leads(*)')
        .eq('id', opportunityId)
        .eq('org_id', profile.org_id)
        .single()
      opportunity = opp
    }

    // Load measurement data
    let measurement = null
    
    // First try explicit measurement_id
    if (measurementId) {
      const { data: meas } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('id', measurementId)
        .maybeSingle()
      measurement = meas
    }
    
    // If no measurement yet, try to find one linked to the opportunity
    if (!measurement && opportunityId) {
      const { data: oppMeasurement } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (oppMeasurement) {
        measurement = oppMeasurement
      }
    }

    const leadFromOpp = opportunity?.leads
      ? Array.isArray(opportunity.leads)
        ? opportunity.leads[0]
        : opportunity.leads
      : null

    // If still no measurement but opportunity has roof_squares, create a virtual measurement object
    if (!measurement && opportunity?.roof_squares) {
      measurement = {
        id: 'from-opportunity',
        total_squares: opportunity.roof_squares,
        total_area_sqft: opportunity.roof_squares * 100,
        address_text: opportunity.address_text || leadFromOpp?.address_text,
        source: 'opportunity',
      }
    }

    // Load roofing types
    const { data: roofingTypesRaw } = await adminClient
      .from('roofing_types')
      .select('*')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('sort_order')
    
    // Map database fields to frontend expected fields
    // Convert pricing based on pricing_unit: sqft needs to be multiplied by 100 to get per-square price
    const roofingTypes = (roofingTypesRaw || []).map((rt: any) => {
      let pricePerSquare = rt.unit_price || 0
      let materialCostPerSquare = rt.material_cost || null
      let laborCostPerSquare = rt.labor_cost || null
      
      // If pricing is per sq ft, multiply by 100 to convert to per square (1 square = 100 sq ft)
      if (rt.pricing_unit === 'sqft') {
        pricePerSquare = pricePerSquare * 100
        if (materialCostPerSquare) materialCostPerSquare = materialCostPerSquare * 100
        if (laborCostPerSquare) laborCostPerSquare = laborCostPerSquare * 100
      }
      
      return {
        ...rt,
        price_per_square: pricePerSquare,
        material_cost_per_square: materialCostPerSquare,
        labor_cost_per_square: laborCostPerSquare,
      }
    })

    // If no pricebook items exist, create default items from org pricing settings
    let pricebookItems = visibleItems.filter((i: any) => !i.is_adder)
    
    if (pricebookItems.length === 0 && orgPricing.price_per_square_installed) {
      // Create virtual pricebook items from org pricing
      const defaultItems = []
      
      if (orgPricing.price_per_square_installed) {
        defaultItems.push({
          id: 'default-roofing-install',
          name: 'Roofing Installation',
          category: 'Roofing',
          unit: 'square',
          unit_price: orgPricing.price_per_square_installed,
          is_adder: false,
          visibility: 'all',
          is_virtual: true, // Flag to indicate this is not from pricebook
        })
      }
      
      if (orgPricing.price_per_watt) {
        defaultItems.push({
          id: 'default-solar-install',
          name: 'Solar Installation',
          category: 'Solar',
          unit: 'watt',
          unit_price: orgPricing.price_per_watt,
          is_adder: false,
          visibility: 'all',
          is_virtual: true,
        })
      }
      
      pricebookItems = defaultItems
    }

    return NextResponse.json({
      pricebookItems,
      adders: visibleItems.filter((i: any) => i.is_adder),
      templates: templates || [],
      roofingTypes: roofingTypes || [],
      opportunity,
      measurement,
      role: profile.role,
      orgId: profile.org_id,
      userId: user.id,
      orgPricing, // Include pricing settings for reference
    })
  } catch (error) {
    console.error('Proposal builder data API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to load builder data' 
    }, { status: 500 })
  }
}

// POST - Create a new proposal
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

    // Get user profile for org_id
    const { data: profile } = await adminClient
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { proposal, lineItems } = body

    // Validate required fields
    if (!proposal.customer_name?.trim()) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }
    if (!proposal.customer_address?.trim()) {
      return NextResponse.json({ error: 'Customer address is required' }, { status: 400 })
    }

    // Generate proposal number
    const { count } = await adminClient
      .from('proposals')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', profile.org_id)

    const proposalNumber = `P-${String((count || 0) + 1).padStart(5, '0')}`

    // Clean up proposal data - ensure required fields are not empty
    const cleanProposal = {
      org_id: profile.org_id,
      created_by: user.id,
      proposal_number: proposalNumber,
      customer_name: proposal.customer_name.trim(),
      customer_email: proposal.customer_email?.trim() || null,
      customer_phone: proposal.customer_phone?.trim() || null,
      customer_address: proposal.customer_address.trim(),
      opportunity_id: proposal.opportunity_id || null,
      title: proposal.title || 'Roofing Proposal',
      status: 'draft',
      subtotal: roundMoney(proposal.subtotal || 0),
      discount_amount: roundMoney(proposal.discount_amount || 0),
      discount_percent: proposal.discount_percent || 0,
      tax_rate: proposal.tax_rate || 0,
      tax_amount: roundMoney(proposal.tax_amount || 0),
      total: roundMoney(proposal.total || 0),
      financing_available: proposal.financing_available || false,
      financing_term_months: proposal.financing_term_months || null,
      financing_rate: proposal.financing_rate || null,
      monthly_payment: proposal.monthly_payment ? roundMoney(proposal.monthly_payment) : null,
      scope_of_work: proposal.scope_of_work || null,
      materials_description: proposal.materials_description || null,
      warranty_info: proposal.warranty_info || null,
      accent_color: proposal.accent_color || '#4f46e5',
    }

    console.log('Creating proposal with data:', JSON.stringify(cleanProposal, null, 2))

    // Create the proposal
    const { data: newProposal, error: proposalError } = await adminClient
      .from('proposals')
      .insert(cleanProposal)
      .select()
      .single()

    if (proposalError) {
      console.error('Proposal creation error:', proposalError)
      return NextResponse.json({ error: `Failed to create proposal: ${proposalError.message}` }, { status: 400 })
    }

    // Create line items (required for a coherent proposal — rollback on failure)
    if (lineItems && lineItems.length > 0) {
      const lineItemsToInsert = lineItems.map((item: any, index: number) => {
        const qty = Number(item.quantity)
        const unitPrice = Number(item.unit_price)
        const lineTotal = Number(item.line_total)
        return {
          org_id: profile.org_id,
          proposal_id: newProposal.id,
          pricebook_item_id: item.pricebook_item_id || null,
          category: String(item.category ?? 'General').trim() || 'General',
          name: String(item.name ?? 'Line item').trim() || 'Line item',
          description: item.description != null ? String(item.description) : '',
          unit: String(item.unit ?? 'each').trim() || 'each',
          quantity: Number.isFinite(qty) ? qty : 0,
          unit_price: Number.isFinite(unitPrice) ? roundMoney(unitPrice) : 0,
          line_total: Number.isFinite(lineTotal) ? roundMoney(lineTotal) : 0,
          is_adder: item.is_adder || false,
          show_to_customer: item.show_to_customer ?? false,
          sort_order: index,
        }
      })

      const { error: lineItemsError } = await adminClient
        .from('proposal_line_items')
        .insert(lineItemsToInsert)

      if (lineItemsError) {
        console.error('Line items creation error:', lineItemsError)
        await adminClient.from('proposals').delete().eq('id', newProposal.id)
        return NextResponse.json(
          { error: `Failed to save proposal line items: ${lineItemsError.message}` },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ proposal: newProposal })
  } catch (error) {
    console.error('Proposal builder API error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to create proposal' 
    }, { status: 500 })
  }
}
