import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import LeadAIHelper from '@/components/LeadAIHelper'
import LeadReferralInfo from '@/components/LeadReferralInfo'
import DeleteLeadButton from '@/components/DeleteLeadButton'
import LocationMap from '@/components/LocationMap'
import { 
  createCalendarEvent, 
  deleteCalendarEvent, 
  refreshAccessToken,
  CalendarEvent 
} from '@/lib/google-calendar'

// Helper to convert UTC ISO string to datetime-local format in Eastern time
function toEasternDatetimeLocal(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  // Format in Eastern timezone
  const eastern = date.toLocaleString('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  // Convert "2026-02-24, 17:40" to "2026-02-24T17:40"
  return eastern.replace(', ', 'T')
}

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  const supabase = createServiceClient()

  let leadQuery = supabase
    .from('leads')
    .select('*, users:users!leads_owner_user_id_fkey(full_name)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    leadQuery = leadQuery.eq('owner_user_id', profile.id)
  }

  const { data: lead } = await leadQuery.single()

  if (!lead) {
    notFound()
  }

  const { data: activities } = await supabase
    .from('activities')
    .select('*, users:users!activities_user_id_fkey(full_name)')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })

  const { data: files } = await supabase
    .from('files')
    .select('*')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })

  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('id, status, inspection_outcome, inspection_notes, inspection_outcome_at')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch inspection status updates for this lead
  const { data: inspectionUpdates } = await supabase
    .from('inspection_status_updates')
    .select('*, closer:users!inspection_status_updates_closer_user_id_fkey(full_name)')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })

  // Fetch scheduled appointments for this lead to check if inspection was scheduled
  const { data: appointments } = await supabase
    .from('scheduled_appointments')
    .select('id, scheduled_for, status, closer_user_id')
    .eq('lead_id', params.id)
    .order('scheduled_for', { ascending: false })

  const { data: closers } = await supabase
    .from('users')
    .select('id, full_name, role')
    .eq('org_id', profile.org_id)
    .order('full_name', { ascending: true })

  const leadStatuses = [
    'new',
    'contacted',
    'appointment',
    'inspection',
    'estimate_sent',
    'won',
    'lost',
  ] as const
  const leadSources = [
    'ad_campaign',
    'door_to_door',
    'call_in',
    'referral',
    'web',
    'other',
  ]

  const closerName =
    (closers || []).find((closer: any) => closer.id === lead.closer_user_id)?.full_name ||
    null

  const canvassDispositions = [
    { id: 'not_home', label: 'Not home (no contact)' },
    { id: 'bad_roof', label: 'Bad roof (no contact)' },
    { id: 'renter', label: 'Renter (unqualified conversation)' },
    { id: 'go_back', label: 'Go back (contact)' },
    { id: 'hot_lead', label: 'Hot lead (contact)' },
    { id: 'not_interested', label: 'Not interested (contact)' },
  ]

  // Update basic lead info (name, phone, email, address)
  const updateLeadInfo = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()
    
    // Verify user has access to this lead
    let leadQuery = supabase
      .from('leads')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
    if (profile.role === 'rep') {
      leadQuery = leadQuery.eq('owner_user_id', profile.id)
    }
    const { data: accessCheck } = await leadQuery.single()
    if (!accessCheck) return

    const homeownerName = String(formData.get('homeowner_name') ?? '')
    const phone = String(formData.get('phone') ?? '')
    const email = String(formData.get('email') ?? '')
    const addressText = String(formData.get('address_text') ?? '')
    const notes = String(formData.get('notes') ?? '')

    await supabase
      .from('leads')
      .update({
        homeowner_name: homeownerName || null,
        phone: phone || null,
        email: email || null,
        address_text: addressText || null,
        notes: notes || null,
      })
      .eq('id', params.id)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      lead_id: params.id,
      user_id: profile.id,
      type: 'note',
      body: 'Lead contact information updated',
    })

    revalidatePath(`/leads/${params.id}`)
  }

  const updateLead = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()
    const status = String(formData.get('status') ?? lead.status)
    const source = String(formData.get('source') ?? lead.source ?? '')
    const canvassDisposition = String(formData.get('canvass_disposition') ?? '')
    const closerUserId = String(formData.get('closer_user_id') ?? '')
    const inspectionScheduledFor = String(formData.get('inspection_scheduled_for') ?? '')
    const canvassNotes = String(formData.get('canvass_notes') ?? '')

    let leadQuery = supabase
      .from('leads')
      .select('*')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
    if (profile.role === 'rep') {
      leadQuery = leadQuery.eq('owner_user_id', profile.id)
    }
    const { data: freshLead } = await leadQuery.single()

    if (!freshLead) return

    // When converting to opportunity (status = inspection), require name, phone, and address
    if (status === 'inspection') {
      const missingFields: string[] = []
      if (!freshLead.homeowner_name?.trim()) missingFields.push('Name')
      if (!freshLead.phone?.trim()) missingFields.push('Phone')
      if (!freshLead.address_text?.trim()) missingFields.push('Address')
      
      if (missingFields.length > 0) {
        throw new Error(`Cannot convert to opportunity. Missing required fields: ${missingFields.join(', ')}. Please update the lead info first.`)
      }
    }

    const updates: Record<string, any> = {
      status,
      source: source || null,
      canvass_disposition: canvassDisposition || null,
      closer_user_id: closerUserId || null,
      canvass_notes: canvassNotes || null,
      inspection_scheduled_for: inspectionScheduledFor
        ? new Date(inspectionScheduledFor).toISOString()
        : null,
    }

    if (status === 'inspection' && !freshLead.inspection_scheduled_at) {
      updates.inspection_scheduled_at = new Date().toISOString()
    }

    // NOTE: We no longer change lead.owner_user_id to the closer
    // The lead owner stays as the setter (who knocked the door)
    // The closer is tracked in lead.closer_user_id and opportunity.owner_user_id
    // This ensures the setter gets credit for door knocks in stats

    await supabase.from('leads').update(updates).eq('id', params.id)

    // Check if inspection time changed and sync to Google Calendar
    const oldScheduledTime = freshLead.inspection_scheduled_for
    const newScheduledTime = inspectionScheduledFor ? new Date(inspectionScheduledFor).toISOString() : null
    
    if (newScheduledTime && oldScheduledTime !== newScheduledTime) {
      // Find existing appointment for this lead
      const { data: existingAppointment } = await supabase
        .from('scheduled_appointments')
        .select('id, google_event_id, closer_user_id, duration_minutes')
        .eq('lead_id', params.id)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      
      const targetCloserId = closerUserId || freshLead.closer_user_id
      
      if (targetCloserId) {
        // Get closer's Google token
        const { data: tokenData } = await supabase
          .from('user_google_tokens')
          .select('*')
          .eq('user_id', targetCloserId)
          .single()
        
        if (tokenData) {
          let accessToken = tokenData.access_token
          const expiresAt = new Date(tokenData.expires_at)
          
          // Refresh token if needed
          if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
            try {
              const refreshed = await refreshAccessToken(tokenData.refresh_token)
              accessToken = refreshed.access_token
              await supabase
                .from('user_google_tokens')
                .update({
                  access_token: refreshed.access_token,
                  expires_at: refreshed.expires_at.toISOString(),
                })
                .eq('user_id', targetCloserId)
            } catch (e) {
              console.error('Failed to refresh token:', e)
            }
          }
          
          // Delete old calendar event if exists
          if (existingAppointment?.google_event_id) {
            try {
              await deleteCalendarEvent(accessToken, existingAppointment.google_event_id)
            } catch (e) {
              console.error('Failed to delete old calendar event:', e)
            }
          }
          
          // Get timezone for closer
          let timezone = 'America/New_York'
          const { data: closerProfile } = await supabase
            .from('users')
            .select('team_id')
            .eq('id', targetCloserId)
            .single()
          
          if (closerProfile?.team_id) {
            const { data: team } = await supabase
              .from('teams')
              .select('timezone')
              .eq('id', closerProfile.team_id)
              .single()
            if (team?.timezone) timezone = team.timezone
          }
          
          // Create new calendar event with local time format
          const localTimeStr = inspectionScheduledFor // Already in YYYY-MM-DDTHH:MM format
          const startDateTime = `${localTimeStr}:00`
          
          const [datePart, timePart] = localTimeStr.split('T')
          const [hourStr, minStr] = timePart.split(':')
          const durationMinutes = existingAppointment?.duration_minutes || 60
          let endHour = parseInt(hourStr, 10)
          let endMin = parseInt(minStr, 10) + durationMinutes
          
          while (endMin >= 60) {
            endMin -= 60
            endHour += 1
          }
          
          const endDateTime = `${datePart}T${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}:00`
          
          const event: CalendarEvent = {
            summary: `Inspection: ${freshLead.homeowner_name || 'Customer'}${oldScheduledTime ? ' (Rescheduled)' : ''}`,
            description: [
              `Customer: ${freshLead.homeowner_name || 'N/A'}`,
              freshLead.phone ? `Phone: ${freshLead.phone}` : '',
              freshLead.address_text ? `Address: ${freshLead.address_text}` : '',
              '',
              freshLead.canvass_notes ? `Canvass Notes:\n${freshLead.canvass_notes}` : '',
            ].filter(line => line !== undefined && line !== '').join('\n').trim(),
            location: freshLead.address_text || undefined,
            start: {
              dateTime: startDateTime,
              timeZone: timezone,
            },
            end: {
              dateTime: endDateTime,
              timeZone: timezone,
            },
          }
          
          try {
            const createdEvent = await createCalendarEvent(accessToken, event)
            
            // Update or create appointment record
            if (existingAppointment) {
              await supabase
                .from('scheduled_appointments')
                .update({
                  scheduled_for: newScheduledTime,
                  google_event_id: createdEvent.id,
                })
                .eq('id', existingAppointment.id)
            } else {
              // Create new appointment record
              await supabase
                .from('scheduled_appointments')
                .insert({
                  org_id: profile.org_id,
                  lead_id: params.id,
                  closer_user_id: targetCloserId,
                  canvasser_user_id: freshLead.owner_user_id,
                  scheduled_for: newScheduledTime,
                  duration_minutes: 60,
                  status: 'scheduled',
                  address_text: freshLead.address_text,
                  google_event_id: createdEvent.id,
                })
            }
          } catch (e) {
            console.error('Failed to create calendar event:', e)
          }
        }
      }
    }

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      lead_id: params.id,
      user_id: profile.id,
      type: 'status_change',
      body: `Lead updated: ${status.replace('_', ' ')}`,
    })

    if (status === 'inspection') {
      // Notify managers about the inspection being scheduled
      // Note: Opportunity is now created when inspection outcome is submitted (if configured)
      const recipients = new Set<string>()
      if (profile.manager_user_id) {
        recipients.add(profile.manager_user_id)
        const { data: managerRow } = await supabase
          .from('users')
          .select('manager_user_id')
          .eq('id', profile.manager_user_id)
          .single()

        if (managerRow?.manager_user_id) {
          recipients.add(managerRow.manager_user_id)
        }
      }

      const recipientIds = Array.from(recipients).filter((id) => id !== profile.id)
      if (recipientIds.length > 0) {
        await supabase.from('notifications').insert(
          recipientIds.map((recipientId) => ({
            org_id: profile.org_id,
            recipient_user_id: recipientId,
            actor_user_id: profile.id,
            type: 'inspection_scheduled',
            title: 'Inspection scheduled',
            body: `${freshLead.homeowner_name || 'Lead'} moved to Inspection.`,
            link_url: `/leads/${params.id}`,
          }))
        )
      }
    }

    revalidatePath(`/leads/${params.id}`)
    revalidatePath('/dashboard')
  }

  // Check if user can delete this lead
  const isAdmin = ['admin', 'regional_manager', 'sales_manager', 'manager'].includes(profile.role)
  const isOwner = lead.owner_user_id === profile.id
  const canDelete = isAdmin || isOwner

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/leads"
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Leads
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Lead Details</h1>
            {canDelete && (
              <DeleteLeadButton leadId={params.id} />
            )}
          </div>
          <form action={updateLeadInfo}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-500">Homeowner Name</label>
                <input
                  type="text"
                  name="homeowner_name"
                  defaultValue={lead.homeowner_name || ''}
                  placeholder="Enter name"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  defaultValue={lead.phone || ''}
                  placeholder="Enter phone"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Email</label>
                <input
                  type="email"
                  name="email"
                  defaultValue={lead.email || ''}
                  placeholder="Enter email"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Address</label>
                <input
                  type="text"
                  name="address_text"
                  defaultValue={lead.address_text || ''}
                  placeholder="Enter address"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-500">Notes</label>
                <textarea
                  name="notes"
                  defaultValue={lead.notes || ''}
                  placeholder="Add notes about this lead..."
                  rows={3}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </form>

          {/* Read-only info */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Status:</span>
                <span className="ml-2 text-gray-900 capitalize">{lead.status.replace('_', ' ')}</span>
              </div>
              <div>
                <span className="text-gray-500">Owner:</span>
                <span className="ml-2 text-gray-900">{lead.users?.full_name || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-gray-500">Closer:</span>
                <span className="ml-2 text-gray-900">{closerName || 'Unassigned'}</span>
              </div>
              <div>
                <span className="text-gray-500">Disposition:</span>
                <span className="ml-2 text-gray-900 capitalize">
                  {lead.canvass_disposition?.replace('_', ' ') || 'Not set'}
                </span>
              </div>
              {lead.inspection_scheduled_for && (
                <div className="col-span-2">
                  <span className="text-gray-500">Inspection:</span>
                  <span className="ml-2 text-gray-900">
                    {new Date(lead.inspection_scheduled_for).toLocaleString('en-US', { 
                      dateStyle: 'medium', 
                      timeStyle: 'short',
                      timeZone: 'America/New_York'
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {lead.lat && lead.lng && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Location</h3>
              <LocationMap 
                lat={lead.lat} 
                lng={lead.lng} 
                address={lead.address_text}
              />
            </div>
          )}
        </div>

        {/* Referral Info - shows if source is referral */}
        <div className="mb-6">
          <LeadReferralInfo
            leadId={params.id}
            leadName={lead.homeowner_name}
            leadPhone={lead.phone}
            leadEmail={lead.email}
            leadAddress={lead.address_text}
            orgId={profile.org_id}
            source={lead.source}
          />
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Lead Workflow</h2>
          <form
            action={updateLead}
            className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
          >
            <div>
              <label className="text-sm font-medium text-gray-500">Source</label>
              <select
                name="source"
                defaultValue={lead.source ?? ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select source</option>
                {leadSources.map((source) => (
                  <option key={source} value={source}>
                    {source.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Canvass disposition</label>
              <select
                name="canvass_disposition"
                defaultValue={lead.canvass_disposition || ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select disposition</option>
                {canvassDispositions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Assigned closer</label>
              <select
                name="closer_user_id"
                defaultValue={lead.closer_user_id || ''}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select closer</option>
                {(closers || []).map((closer: any) => (
                  <option key={closer.id} value={closer.id}>
                    {closer.full_name || closer.id} ({closer.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Inspection scheduled for (ET)</label>
              <input
                name="inspection_scheduled_for"
                type="datetime-local"
                defaultValue={toEasternDatetimeLocal(lead.inspection_scheduled_for)}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Status</label>
              <select
                name="status"
                defaultValue={lead.status}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {leadStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-500">Canvass notes</label>
              <textarea
                name="canvass_notes"
                defaultValue={lead.canvass_notes || ''}
                rows={3}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-10 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Update lead
            </button>
          </form>
          <div className="mt-4 text-sm text-gray-600">
            {opportunity ? (
              <span>
                Opportunity created.{' '}
                <Link
                  href={`/opportunities/${opportunity.id}`}
                  className="text-indigo-600 hover:text-indigo-800"
                >
                  View opportunity →
                </Link>
              </span>
            ) : (
              <span>Opportunity will be created based on inspection outcome.</span>
            )}
          </div>
        </div>

        {/* Inspection Status Section */}
        {(lead.status === 'inspection' || (appointments && appointments.length > 0) || (inspectionUpdates && inspectionUpdates.length > 0)) && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Inspection Status</h2>
            
            {inspectionUpdates && inspectionUpdates.length > 0 ? (
              <div className="space-y-4">
                {/* Latest outcome summary */}
                <div className="p-4 rounded-lg bg-gray-50 border">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      inspectionUpdates[0].outcome === 'sale' ? 'bg-green-100 text-green-700' :
                      inspectionUpdates[0].outcome === 'moving_to_close' ? 'bg-emerald-100 text-emerald-700' :
                      inspectionUpdates[0].outcome === 'insurance_follow_up' ? 'bg-cyan-100 text-cyan-700' :
                      inspectionUpdates[0].outcome === 'said_no' ? 'bg-red-100 text-red-700' :
                      inspectionUpdates[0].outcome === 'not_home' ? 'bg-yellow-100 text-yellow-700' :
                      inspectionUpdates[0].outcome === 'needs_repair' ? 'bg-orange-100 text-orange-700' :
                      inspectionUpdates[0].outcome === 'rescheduled' ? 'bg-blue-100 text-blue-700' :
                      inspectionUpdates[0].outcome === 'no_problems_found' ? 'bg-gray-100 text-gray-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {inspectionUpdates[0].outcome === 'sale' ? '✓ Sale' :
                       inspectionUpdates[0].outcome === 'moving_to_close' ? 'Moving to Close' :
                       inspectionUpdates[0].outcome === 'insurance_follow_up' ? 'Insurance Follow Up' :
                       inspectionUpdates[0].outcome === 'said_no' ? 'Said No' :
                       inspectionUpdates[0].outcome === 'not_home' ? 'Not Home' :
                       inspectionUpdates[0].outcome === 'needs_repair' ? 'Needs Repair' :
                       inspectionUpdates[0].outcome === 'rescheduled' ? 'Rescheduled' :
                       inspectionUpdates[0].outcome === 'no_problems_found' ? 'No Problems Found' :
                       inspectionUpdates[0].outcome?.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(inspectionUpdates[0].created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                    </span>
                  </div>
                  {inspectionUpdates[0].closer?.full_name && (
                    <p className="text-sm text-gray-600 mb-2">
                      Updated by: {inspectionUpdates[0].closer.full_name}
                    </p>
                  )}
                  {inspectionUpdates[0].notes && (
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">Notes:</span> {inspectionUpdates[0].notes}
                    </p>
                  )}
                  {inspectionUpdates[0].setter_feedback && (
                    <p className="text-sm text-indigo-700 bg-indigo-50 p-2 rounded mt-2">
                      <span className="font-medium">Setter Feedback:</span> {inspectionUpdates[0].setter_feedback}
                    </p>
                  )}
                </div>

                {/* History if more than one update */}
                {inspectionUpdates.length > 1 && (
                  <details className="mt-4">
                    <summary className="text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                      View history ({inspectionUpdates.length - 1} previous update{inspectionUpdates.length > 2 ? 's' : ''})
                    </summary>
                    <div className="mt-3 space-y-3">
                      {inspectionUpdates.slice(1).map((update: any) => (
                        <div key={update.id} className="p-3 border rounded-lg bg-gray-50">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              update.outcome === 'sale' ? 'bg-green-100 text-green-700' :
                              update.outcome === 'said_no' ? 'bg-red-100 text-red-700' :
                              update.outcome === 'not_home' ? 'bg-yellow-100 text-yellow-700' :
                              update.outcome === 'rescheduled' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-700'
                            }`}>
                              {update.outcome?.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(update.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}
                            </span>
                          </div>
                          {update.notes && (
                            <p className="text-sm text-gray-700">{update.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              /* No inspection updates yet */
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-medium text-amber-800">Inspection Flow Not Updated</h3>
                    <p className="text-sm text-amber-700 mt-1">
                      The inspection outcome has not been recorded yet. 
                      {(appointments && appointments.length > 0 && appointments[0].scheduled_for) ? (
                        <span>
                          {' '}Inspection was scheduled for{' '}
                          {new Date(appointments[0].scheduled_for).toLocaleString('en-US', { 
                            dateStyle: 'medium', 
                            timeStyle: 'short',
                            timeZone: 'America/New_York' 
                          })}.
                        </span>
                      ) : lead.inspection_scheduled_for ? (
                        <span>
                          {' '}Inspection was scheduled for{' '}
                          {new Date(lead.inspection_scheduled_for).toLocaleString('en-US', { 
                            dateStyle: 'medium', 
                            timeStyle: 'short',
                            timeZone: 'America/New_York' 
                          })}.
                        </span>
                      ) : null}
                    </p>
                    <Link
                      href={appointments && appointments.length > 0 
                        ? `/appointments/feedback?id=${appointments[0].id}&lead_id=${params.id}` 
                        : `/appointments/feedback?lead_id=${params.id}`
                      }
                      className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                      Update Inspection Status
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Activities</h2>
            <div className="space-y-4">
              {activities && activities.length > 0 ? (
                activities.map((activity: any) => (
                  <div key={activity.id} className="border-b border-gray-200 pb-3">
                    <div className="flex justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {activity.users?.full_name || 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(activity.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1 capitalize">
                      {activity.type.replace('_', ' ')}
                    </p>
                    <p className="text-sm text-gray-800 mt-1">{activity.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No activities</p>
              )}
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Files & Photos</h2>
            <div className="space-y-2">
              {files && files.length > 0 ? (
                files.map((file: any) => (
                  <div key={file.id} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm text-gray-900">{file.file_name}</span>
                    <span className="text-xs text-gray-500 capitalize">{file.tag}</span>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-sm">No files</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <LeadAIHelper leadId={params.id} />
    </div>
  )
}
