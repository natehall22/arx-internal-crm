import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

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
    
    // Collect candidate addresses from the import batch to check for duplicates in DB
    const candidateAddresses = leads
      .map((l: any) => l.address_text?.toLowerCase().trim())
      .filter(Boolean) as string[]

    // Only fetch existing leads that share an address with the import — avoids full-table scan
    const { data: existingLeads } = candidateAddresses.length > 0
      ? await supabase
          .from('leads')
          .select('address_text, lat, lng')
          .eq('org_id', profile.org_id)
          .in('address_text', candidateAddresses)
      : { data: [] }

    // Create a set of existing addresses and coordinates for fast lookup
    const existingAddresses = new Set(
      (existingLeads || []).map((l: any) => l.address_text?.toLowerCase().trim()).filter(Boolean)
    )
    const existingCoords = new Set(
      (existingLeads || [])
        .filter((l: any) => l.lat && l.lng)
        .map((l: any) => `${Number(l.lat).toFixed(6)},${Number(l.lng).toFixed(6)}`)
    )

    const leadsToInsert = leads
      .filter((lead: any) => {
        // Skip if address already exists
        const addr = lead.address_text?.toLowerCase().trim()
        if (addr && existingAddresses.has(addr)) {
          return false
        }
        // Skip if exact coordinates already exist
        if (lead.lat && lead.lng) {
          const coordKey = `${Number(lead.lat).toFixed(6)},${Number(lead.lng).toFixed(6)}`
          if (existingCoords.has(coordKey)) {
            return false
          }
        }
        return true
      })
      .map((lead: any) => ({
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

    if (leadsToInsert.length === 0) {
      return NextResponse.json({ 
        success: true, 
        count: 0,
        skipped: leads.length,
        message: `All ${leads.length} leads already exist (duplicates skipped)`
      })
    }

    const { data, error } = await supabase
      .from('leads')
      .insert(leadsToInsert)
      .select('id, canvass_disposition')

    if (error) {
      console.error('Import error:', error)
      return NextResponse.json({ error: 'Failed to import leads' }, { status: 500 })
    }

    // Each imported lead counts as a door on the dashboard "doors knocked" stat
    // immediately — csv_import is one of the unconditional-by-source values that RPC
    // recognizes, no disposition required (202608250002_dashboard_door_counts_from_knocks.sql).
    // Historically that came for free from leads.created_at; now that counting reads
    // canvass_knocks (202608250001_canvass_knocks.sql) it has to be logged explicitly,
    // or freshly imported leads would silently show zero doors there. Note this does NOT
    // extend to setter-ramp / Heat bonus qualification: those already
    // (pre-dating this change) filter to door_to_door/canvass/door_knock only — a bulk
    // CSV upload deliberately doesn't count toward a bonus that's meant to reward actual
    // door-to-door work. Service-role client: canvass_knocks has no RLS policies
    // (service-role-only), same as every other write to it (app/api/canvass/lead/route.ts).
    if (data && data.length > 0) {
      const admin = createServiceClient()
      const { error: knockError } = await admin.from('canvass_knocks').insert(
        data.map((row: { id: string; canvass_disposition: string | null }) => ({
          org_id: profile.org_id,
          lead_id: row.id,
          user_id: user.id,
          disposition: row.canvass_disposition,
          source: 'csv_import',
        }))
      )
      if (knockError) {
        // Non-blocking: the import already succeeded and must not fail on this side effect.
        console.error('Failed to log canvass knocks for import:', knockError)
      }
    }

    const skipped = leads.length - leadsToInsert.length
    return NextResponse.json({ 
      success: true, 
      count: data?.length || 0,
      skipped,
      message: `Imported ${data?.length || 0} leads${skipped > 0 ? ` (${skipped} duplicates skipped)` : ''}`
    })

  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
