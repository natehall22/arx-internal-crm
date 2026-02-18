import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's org_id
    const { data: profile } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 400 })
    }

    const { leads } = await request.json()

    if (!Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'No leads provided' }, { status: 400 })
    }

    // Map various status/disposition formats to our standard values
    const dispositionMap: Record<string, string> = {
      // Standard values
      'not_home': 'not_home',
      'bad_roof': 'bad_roof', 
      'renter': 'renter',
      'go_back': 'go_back',
      'hot_lead': 'hot_lead',
      'not_interested': 'not_interested',
      // SalesRabbit / human readable formats
      'not home': 'not_home',
      'nothome': 'not_home',
      'bad roof': 'bad_roof',
      'badroof': 'bad_roof',
      'go back': 'go_back',
      'goback': 'go_back',
      'hot lead': 'hot_lead',
      'hotlead': 'hot_lead',
      'not interested': 'not_interested',
      'notinterested': 'not_interested',
      'ni': 'not_interested',
      // Additional common values
      'inspection set': 'hot_lead',
      'inspectionset': 'hot_lead',
      'inspection': 'hot_lead',
      'sale': 'hot_lead',
      'sold': 'hot_lead',
      'callback': 'go_back',
      'call back': 'go_back',
    }
    
    const normalizeDisposition = (value: string | null | undefined): string | null => {
      if (!value) return null
      const normalized = value.toLowerCase().trim()
      return dispositionMap[normalized] || null
    }
    
    const leadsToInsert = leads.map(lead => ({
      org_id: profile.org_id,
      owner_user_id: user.id,
      status: 'new',
      source: 'csv_import',
      homeowner_name: lead.homeowner_name || null,
      address_text: lead.address_text || null,
      phone: lead.phone || null,
      email: lead.email || null,
      lat: lead.lat,
      lng: lead.lng,
      canvass_disposition: normalizeDisposition(lead.canvass_disposition),
      canvass_notes: lead.canvass_notes || null,
    }))

    const { data, error } = await supabase
      .from('leads')
      .insert(leadsToInsert)
      .select('id')

    if (error) {
      console.error('Import error:', error)
      return NextResponse.json({ error: 'Failed to import leads' }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      count: data?.length || 0,
      message: `Successfully imported ${data?.length || 0} leads`
    })

  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
