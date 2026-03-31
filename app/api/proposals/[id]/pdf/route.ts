import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get proposal with related data
    const { data: proposal, error: proposalError } = await supabase
      .from('proposals')
      .select(`
        *,
        users:created_by(full_name, email, phone),
        orgs:org_id(name, logo_url, phone, email, address, website)
      `)
      .eq('id', params.id)
      .single()

    if (proposalError || !proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Get line items
    const { data: lineItems } = await supabase
      .from('proposal_line_items')
      .select('*')
      .eq('proposal_id', params.id)
      .order('sort_order')

    // Get measurement data if linked
    const { data: measurement } = await supabase
      .from('roof_measurements')
      .select('*')
      .eq('proposal_id', params.id)
      .maybeSingle()

    // If no direct link, try via opportunity
    let measurementData = measurement
    if (!measurementData && proposal.opportunity_id) {
      const { data: oppMeasurement } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('opportunity_id', proposal.opportunity_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      measurementData = oppMeasurement
    }

    return NextResponse.json({
      proposal,
      lineItems: lineItems || [],
      measurement: measurementData,
      company: proposal.orgs,
      rep: proposal.users,
    })
  } catch (error) {
    console.error('Error fetching proposal data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pdfUrl } = await request.json()

    // Update proposal with PDF URL
    const { error } = await supabase
      .from('proposals')
      .update({ 
        pdf_url: pdfUrl,
        pdf_generated_at: new Date().toISOString()
      })
      .eq('id', params.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error updating proposal:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
