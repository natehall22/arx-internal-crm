import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { computeFinancedContractTotal } from '@/lib/financing'
import { SALE_AGREEMENT_TYPES } from '@/lib/sales-metrics'
import { roundMoney } from '@/lib/money'

export const dynamic = 'force-dynamic'
const SOLD_SQUARE_FIELDS = [
  'measured_squares',
  'sold_waste_percent',
  'sold_squares',
  'recommended_order_squares',
] as const

function stripSoldSquareFields<T extends Record<string, unknown>>(proposal: T): T {
  const next = { ...proposal }
  for (const field of SOLD_SQUARE_FIELDS) {
    delete next[field]
  }
  return next as T
}

function missingSoldSquareColumn(error: { message?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase()
  return SOLD_SQUARE_FIELDS.some((field) => message.includes(field))
}

async function mergeFinancingIntoProposal(
  adminClient: SupabaseClient,
  orgId: string,
  proposal: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const baseTotal = roundMoney(Number(proposal.total) || 0)
  const financingAvailable = Boolean(proposal.financing_available)
  const programId = (proposal.financing_program_id as string | null | undefined) || null

  if (!financingAvailable) {
    return {
      financing_program_id: null,
      financing_lender_name: null,
      dealer_fee_percent: null,
      dealer_fee_amount: 0,
      financed_contract_total: baseTotal,
      monthly_payment: null,
    }
  }

  let financing_program_id: string | null = null
  let financing_lender_name: string | null = null
  let dealer_fee_percent: number | null = null
  let dealer_fee_amount = 0
  let financed_contract_total = baseTotal
  let rate = Number(proposal.financing_rate ?? 0)
  let months = Number(proposal.financing_term_months ?? 60)

  if (programId) {
    const { data: program } = await adminClient
      .from('financing_programs')
      .select('*')
      .eq('id', programId)
      .eq('org_id', orgId)
      .eq('active', true)
      .maybeSingle()

    if (program) {
      const comp = computeFinancedContractTotal(baseTotal, program.dealer_fee_percent)
      financing_program_id = program.id
      financing_lender_name = program.lender_name
      dealer_fee_percent = Number(program.dealer_fee_percent)
      dealer_fee_amount = comp.dealerFeeAmount
      financed_contract_total = comp.financedContractTotal
      rate = Number(program.financing_rate)
      months = Number(program.term_months) || 60
    } else {
      const comp = computeFinancedContractTotal(baseTotal, null)
      dealer_fee_amount = comp.dealerFeeAmount
      financed_contract_total = comp.financedContractTotal
    }
  } else {
    const comp = computeFinancedContractTotal(baseTotal, null)
    dealer_fee_amount = comp.dealerFeeAmount
    financed_contract_total = comp.financedContractTotal
  }

  const principal = financed_contract_total
  const monthlyRate = rate / 100 / 12
  let monthly_payment: number | null = null
  if (months > 0) {
    if (monthlyRate === 0) monthly_payment = roundMoney(principal / months)
    else {
      monthly_payment = roundMoney(
        (principal * (monthlyRate * Math.pow(1 + monthlyRate, months))) /
          (Math.pow(1 + monthlyRate, months) - 1)
      )
    }
  }

  return {
    financing_program_id,
    financing_lender_name,
    dealer_fee_percent,
    dealer_fee_amount,
    financed_contract_total,
    financing_rate: rate,
    financing_term_months: months,
    monthly_payment,
  }
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
    const opportunityIdParam = searchParams.get('opportunity_id')
    const measurementId = searchParams.get('measurement_id')
    const proposalIdParam = searchParams.get('proposal_id')

    let existingProposal: { proposal: Record<string, unknown>; lineItems: Record<string, unknown>[] } | null = null
    let proposalOpportunityId: string | null = null

    if (proposalIdParam) {
      const { data: propRow, error: propErr } = await adminClient
        .from('proposals')
        .select('*')
        .eq('id', proposalIdParam)
        .eq('org_id', profile.org_id)
        .single()

      if (!propErr && propRow) {
        proposalOpportunityId = (propRow as { opportunity_id?: string | null }).opportunity_id ?? null
        const { data: lineRows } = await adminClient
          .from('proposal_line_items')
          .select('*')
          .eq('proposal_id', proposalIdParam)
          .order('sort_order')

        existingProposal = {
          proposal: propRow as Record<string, unknown>,
          lineItems: (lineRows || []) as Record<string, unknown>[],
        }
      }
    }

    const effectiveOpportunityId = opportunityIdParam || proposalOpportunityId

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

    // Load opportunity data if provided (URL or from proposal being edited)
    let opportunity = null
    if (effectiveOpportunityId) {
      const { data: opp } = await adminClient
        .from('opportunities')
        .select('*, leads(*), customers(*)')
        .eq('id', effectiveOpportunityId)
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
    if (!measurement && effectiveOpportunityId) {
      const { data: oppMeasurement } = await adminClient
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', effectiveOpportunityId)
        .eq('status', 'completed')
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

    const { data: financingPrograms } = await adminClient
      .from('financing_programs')
      .select('id, org_id, lender_name, financing_rate, term_months, sort_order, active, created_at, updated_at')
      .eq('org_id', profile.org_id)
      .eq('active', true)
      .order('sort_order')
      .order('lender_name')

    return NextResponse.json({
      pricebookItems,
      adders: visibleItems.filter((i: any) => i.is_adder),
      templates: templates || [],
      roofingTypes: roofingTypes || [],
      financingPrograms: financingPrograms || [],
      opportunity,
      measurement,
      existingProposal,
      opportunityIdFromProposal: proposalOpportunityId,
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
    const cleanProposal: Record<string, unknown> = {
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
      financing_program_id: proposal.financing_program_id || null,
      financing_term_months: proposal.financing_term_months || null,
      financing_rate: proposal.financing_rate || null,
      monthly_payment: proposal.monthly_payment ? roundMoney(proposal.monthly_payment) : null,
      scope_of_work: proposal.scope_of_work || null,
      materials_description: proposal.materials_description || null,
      warranty_info: proposal.warranty_info || null,
      measured_squares: proposal.measured_squares != null ? Number(proposal.measured_squares) : null,
      sold_waste_percent: proposal.sold_waste_percent != null ? Number(proposal.sold_waste_percent) : null,
      sold_squares: proposal.sold_squares != null ? Number(proposal.sold_squares) : null,
      recommended_order_squares:
        proposal.recommended_order_squares != null ? Number(proposal.recommended_order_squares) : null,
      accent_color: proposal.accent_color || '#4f46e5',
    }

    const financingMerged = await mergeFinancingIntoProposal(adminClient, profile.org_id, {
      ...cleanProposal,
      financing_program_id: proposal.financing_program_id,
    })
    Object.assign(cleanProposal, financingMerged)

    console.log('Creating proposal with data:', JSON.stringify(cleanProposal, null, 2))

    // Create the proposal
    let { data: newProposal, error: proposalError } = await adminClient
      .from('proposals')
      .insert(cleanProposal)
      .select()
      .single()

    if (proposalError && missingSoldSquareColumn(proposalError)) {
      ;({ data: newProposal, error: proposalError } = await adminClient
        .from('proposals')
        .insert(stripSoldSquareFields(cleanProposal))
        .select()
        .single())
    }

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

// PUT — Update an existing proposal and replace line items (draft / sent / viewed)
export async function PUT(request: NextRequest) {
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
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    const body = await request.json()
    const { proposal_id, proposal, lineItems } = body as {
      proposal_id?: string
      proposal: Record<string, unknown>
      lineItems?: unknown[]
    }

    if (!proposal_id || typeof proposal_id !== 'string') {
      return NextResponse.json({ error: 'proposal_id is required' }, { status: 400 })
    }

    const { data: existing, error: existingError } = await adminClient
      .from('proposals')
      .select('id, org_id, status')
      .eq('id', proposal_id)
      .eq('org_id', profile.org_id)
      .single()

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    if (['accepted', 'declined'].includes(String(existing.status))) {
      return NextResponse.json(
        { error: 'Cannot edit accepted or declined proposals' },
        { status: 400 }
      )
    }

    const { data: signedSaleAgreement } = await adminClient
      .from('order_form_contracts')
      .select('id')
      .eq('org_id', profile.org_id)
      .eq('proposal_id', proposal_id)
      .in('agreement_type', SALE_AGREEMENT_TYPES)
      .eq('status', 'completed')
      .limit(1)
      .maybeSingle()

    if (signedSaleAgreement) {
      return NextResponse.json(
        { error: 'Cannot edit a proposal after a signed Installation or Repair Agreement exists' },
        { status: 400 }
      )
    }

    if (!proposal?.customer_name || !String(proposal.customer_name).trim()) {
      return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })
    }
    if (!proposal?.customer_address || !String(proposal.customer_address).trim()) {
      return NextResponse.json({ error: 'Customer address is required' }, { status: 400 })
    }

    const cleanProposal: Record<string, unknown> = {
      customer_name: String(proposal.customer_name).trim(),
      customer_email: proposal.customer_email ? String(proposal.customer_email).trim() : null,
      customer_phone: proposal.customer_phone ? String(proposal.customer_phone).trim() : null,
      customer_address: String(proposal.customer_address).trim(),
      opportunity_id: proposal.opportunity_id ? String(proposal.opportunity_id) : null,
      title: proposal.title ? String(proposal.title) : 'Roofing Proposal',
      status: proposal.status ? String(proposal.status) : 'draft',
      subtotal: roundMoney(Number(proposal.subtotal) || 0),
      discount_amount: roundMoney(Number(proposal.discount_amount) || 0),
      discount_percent: Number(proposal.discount_percent) || 0,
      tax_rate: Number(proposal.tax_rate) || 0,
      tax_amount: roundMoney(Number(proposal.tax_amount) || 0),
      total: roundMoney(Number(proposal.total) || 0),
      financing_available: Boolean(proposal.financing_available),
      financing_program_id: proposal.financing_program_id ? String(proposal.financing_program_id) : null,
      financing_term_months: proposal.financing_term_months != null ? Number(proposal.financing_term_months) : null,
      financing_rate: proposal.financing_rate != null ? Number(proposal.financing_rate) : null,
      monthly_payment: proposal.monthly_payment != null ? roundMoney(Number(proposal.monthly_payment)) : null,
      scope_of_work: proposal.scope_of_work != null ? String(proposal.scope_of_work) : null,
      materials_description: proposal.materials_description != null ? String(proposal.materials_description) : null,
      warranty_info: proposal.warranty_info != null ? String(proposal.warranty_info) : null,
      measured_squares: proposal.measured_squares != null ? Number(proposal.measured_squares) : null,
      sold_waste_percent: proposal.sold_waste_percent != null ? Number(proposal.sold_waste_percent) : null,
      sold_squares: proposal.sold_squares != null ? Number(proposal.sold_squares) : null,
      recommended_order_squares:
        proposal.recommended_order_squares != null ? Number(proposal.recommended_order_squares) : null,
      accent_color: proposal.accent_color ? String(proposal.accent_color) : '#4f46e5',
      updated_at: new Date().toISOString(),
    }

    const financingMerged = await mergeFinancingIntoProposal(adminClient, profile.org_id, {
      ...cleanProposal,
      financing_program_id: proposal.financing_program_id,
    })
    Object.assign(cleanProposal, financingMerged)

    let { data: updated, error: updateError } = await adminClient
      .from('proposals')
      .update(cleanProposal)
      .eq('id', proposal_id)
      .eq('org_id', profile.org_id)
      .select()
      .single()

    if (updateError && missingSoldSquareColumn(updateError)) {
      ;({ data: updated, error: updateError } = await adminClient
        .from('proposals')
        .update(stripSoldSquareFields(cleanProposal))
        .eq('id', proposal_id)
        .eq('org_id', profile.org_id)
        .select()
        .single())
    }

    if (updateError) {
      console.error('Proposal update error:', updateError)
      return NextResponse.json({ error: `Failed to update proposal: ${updateError.message}` }, { status: 400 })
    }

    const { error: delErr } = await adminClient
      .from('proposal_line_items')
      .delete()
      .eq('proposal_id', proposal_id)

    if (delErr) {
      console.error('Line items delete error:', delErr)
      return NextResponse.json({ error: `Failed to clear line items: ${delErr.message}` }, { status: 400 })
    }

    if (lineItems && lineItems.length > 0) {
      const lineItemsToInsert = lineItems.map((item: any, index: number) => {
        const qty = Number(item.quantity)
        const unitPrice = Number(item.unit_price)
        const lineTotal = Number(item.line_total)
        return {
          org_id: profile.org_id,
          proposal_id,
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

      const { error: lineItemsError } = await adminClient.from('proposal_line_items').insert(lineItemsToInsert)

      if (lineItemsError) {
        console.error('Line items insert error:', lineItemsError)
        return NextResponse.json(
          { error: `Failed to save proposal line items: ${lineItemsError.message}` },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({ proposal: updated })
  } catch (error) {
    console.error('Proposal builder PUT error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update proposal' },
      { status: 500 }
    )
  }
}
