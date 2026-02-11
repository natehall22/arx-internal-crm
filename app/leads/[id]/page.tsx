import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import LeadAIHelper from '@/components/LeadAIHelper'
import LeadReferralInfo from '@/components/LeadReferralInfo'
import DeleteLeadButton from '@/components/DeleteLeadButton'

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
    .select('id, status')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

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

    if (status === 'inspection' && closerUserId) {
      updates.owner_user_id = closerUserId
    }

    await supabase.from('leads').update(updates).eq('id', params.id)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      lead_id: params.id,
      user_id: profile.id,
      type: 'status_change',
      body: `Lead updated: ${status.replace('_', ' ')}`,
    })

    if (status === 'inspection') {
      const { data: existingOpportunity } = await supabase
        .from('opportunities')
        .select('id')
        .eq('lead_id', params.id)
        .maybeSingle()

      let opportunityId = existingOpportunity?.id ?? null
      const assignedOwnerId = closerUserId || freshLead.owner_user_id

      if (!existingOpportunity) {
        const { data: createdOpportunity } = await supabase
          .from('opportunities')
          .insert({
            org_id: profile.org_id,
            lead_id: params.id,
            owner_user_id: assignedOwnerId,
            status: 'open',
            project_type: 'roofing',
            address_text: freshLead.address_text,
            lat: freshLead.lat,
            lng: freshLead.lng,
            notes: freshLead.notes,
          })
          .select('id')
          .single()

        opportunityId = createdOpportunity?.id ?? null

        await supabase.from('activities').insert({
          org_id: profile.org_id,
          lead_id: params.id,
          user_id: profile.id,
          type: 'status_change',
          body: 'Opportunity created from inspection scheduled.',
        })
      }

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
        const linkUrl = opportunityId ? `/opportunities/${opportunityId}` : `/leads/${params.id}`
        const bodySuffix = opportunityId ? 'Opportunity created.' : 'Lead updated.'
        await supabase.from('notifications').insert(
          recipientIds.map((recipientId) => ({
            org_id: profile.org_id,
            recipient_user_id: recipientId,
            actor_user_id: profile.id,
            type: 'inspection_scheduled',
            title: 'Inspection scheduled',
            body: `${freshLead.homeowner_name || 'Lead'} moved to Inspection. ${bodySuffix}`,
            link_url: linkUrl,
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
                    {new Date(lead.inspection_scheduled_for).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {lead.lat && lead.lng && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Location</h3>
              <div className="h-48 bg-gray-200 rounded flex items-center justify-center">
                <p className="text-gray-500 text-sm">
                  Coordinates: {lead.lat}, {lead.lng}
                </p>
              </div>
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
              <label className="text-sm font-medium text-gray-500">Inspection scheduled for</label>
              <input
                name="inspection_scheduled_for"
                type="datetime-local"
                defaultValue={lead.inspection_scheduled_for?.slice(0, 16) || ''}
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
              <span>Opportunity will be created automatically when status is set to Inspection.</span>
            )}
          </div>
        </div>

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
