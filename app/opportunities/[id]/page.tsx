export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export default async function OpportunityDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  // Use service client to bypass RLS
  const supabase = createServiceClient()

  let opportunityQuery = supabase
    .from('opportunities')
    .select('*, customers(*), leads(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  if (profile.role === 'rep') {
    opportunityQuery = opportunityQuery.eq('owner_user_id', profile.id)
  }

  const { data: opportunity } = await opportunityQuery.single()

  if (!opportunity) {
    notFound()
  }

  const { data: activities } = await supabase
    .from('activities')
    .select('*, users(full_name)')
    .eq('opportunity_id', params.id)
    .order('created_at', { ascending: false })

  const { data: files } = await supabase
    .from('files')
    .select('*')
    .eq('opportunity_id', params.id)
    .order('created_at', { ascending: false })

  const designPdfUrl = opportunity.design_pdf_path
    ? (
        await supabase.storage
          .from('files')
          .createSignedUrl(opportunity.design_pdf_path, 3600)
      ).data?.signedUrl
    : null

  // Fetch proposals for this opportunity
  const { data: proposals } = await supabase
    .from('proposals')
    .select('id, proposal_number, title, status, total, created_at')
    .eq('opportunity_id', params.id)
    .order('created_at', { ascending: false })

  // Fetch roof measurements for this opportunity
  const { data: measurements } = await supabase
    .from('roof_measurements')
    .select('id, source, status, total_area_sqft, total_squares, predominant_pitch, facet_count, created_at')
    .eq('opportunity_id', params.id)
    .order('created_at', { ascending: false })

  // Check if in-house measure tool is enabled for this org
  const { data: orgSettings } = await supabase
    .from('orgs')
    .select('settings')
    .eq('id', profile.org_id)
    .single()
  
  const measureToolEnabled = orgSettings?.settings?.measure_tool_enabled !== false // Default to enabled

  const uploadDesignPdf = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()

    const file = formData.get('design_pdf')
    if (!(file instanceof File) || file.size === 0) return

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `org/${profile.org_id}/opportunities/${params.id}/design/${Date.now()}_${file.name}`

    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Design upload error:', uploadError)
      return
    }

    await supabase
      .from('opportunities')
      .update({
        design_pdf_path: storagePath,
        status: opportunity.status === 'open' ? 'in_progress' : opportunity.status,
      })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: params.id,
      user_id: profile.id,
      type: 'note',
      body: 'Design PDF uploaded.',
    })

    revalidatePath(`/opportunities/${params.id}`)
  }

  const uploadSignedContract = async (formData: FormData) => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()

    const file = formData.get('signed_contract')
    if (!(file instanceof File) || file.size === 0) return

    let opportunityQuery = supabase
      .from('opportunities')
      .select('*, leads(*)')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (profile.role === 'rep') {
      opportunityQuery = opportunityQuery.eq('owner_user_id', profile.id)
    }

    const { data: freshOpportunity } = await opportunityQuery.single()
    if (!freshOpportunity) return

    const { data: existingProject } = freshOpportunity.lead_id
      ? await supabase
          .from('projects')
          .select('id')
          .eq('lead_id', freshOpportunity.lead_id)
          .maybeSingle()
      : { data: null }

    let customerId = freshOpportunity.customer_id
    if (!customerId) {
      const lead = freshOpportunity.leads
      const { data: customer } = await supabase
        .from('customers')
        .insert({
          org_id: profile.org_id,
          name: lead?.homeowner_name ?? null,
          phone: lead?.phone ?? null,
          email: lead?.email ?? null,
          address_text: lead?.address_text ?? null,
        })
        .select('*')
        .single()

      customerId = customer?.id ?? null
    }

    let projectId = existingProject?.id ?? null
    if (!projectId) {
      const { data: createdProject } = await supabase
        .from('projects')
        .insert({
          org_id: profile.org_id,
          customer_id: customerId,
          lead_id: freshOpportunity.lead_id,
          owner_user_id: freshOpportunity.owner_user_id,
          status: 'open',
          project_type: freshOpportunity.project_type,
          address_text: freshOpportunity.address_text,
          lat: freshOpportunity.lat,
          lng: freshOpportunity.lng,
          roof_squares: freshOpportunity.roof_squares,
          siding_squares: freshOpportunity.siding_squares,
          vents_count: freshOpportunity.vents_count,
          layers: freshOpportunity.layers,
          total_windows: freshOpportunity.total_windows,
          windows_by_type: freshOpportunity.windows_by_type,
          notes: freshOpportunity.notes,
        })
        .select('id')
        .single()

      projectId = createdProject?.id ?? null
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const storagePath = `org/${profile.org_id}/opportunities/${params.id}/contracts/${Date.now()}_${file.name}`

    const { error: uploadError } = await supabase.storage
      .from('files')
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('Contract upload error:', uploadError)
      return
    }

    await supabase.from('files').insert({
      org_id: profile.org_id,
      opportunity_id: params.id,
      project_id: projectId,
      customer_id: customerId,
      user_id: profile.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type,
      tag: 'contract',
    })

    await supabase
      .from('opportunities')
      .update({ status: 'won', customer_id: customerId })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (freshOpportunity.lead_id) {
      await supabase
        .from('leads')
        .update({ status: 'won' })
        .eq('id', freshOpportunity.lead_id)
        .eq('org_id', profile.org_id)
    }

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: params.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Signed contract uploaded. Project created.',
    })

    if (projectId) {
      await supabase.from('activities').insert({
        org_id: profile.org_id,
        project_id: projectId,
        user_id: profile.id,
        type: 'status_change',
        body: 'Project created from signed contract.',
      })
    }

    revalidatePath(`/opportunities/${params.id}`)
    if (projectId) {
      revalidatePath(`/projects/${projectId}`)
    }
  }

  const markOpportunityLost = async () => {
    'use server'
    const { profile } = await requireAuth()
    const supabase = createServiceClient()

    await supabase
      .from('opportunities')
      .update({ status: 'lost' })
      .eq('id', params.id)
      .eq('org_id', profile.org_id)

    if (opportunity.lead_id) {
      await supabase
        .from('leads')
        .update({ status: 'lost' })
        .eq('id', opportunity.lead_id)
        .eq('org_id', profile.org_id)
    }

    await supabase.from('activities').insert({
      org_id: profile.org_id,
      opportunity_id: params.id,
      user_id: profile.id,
      type: 'status_change',
      body: 'Opportunity marked as lost.',
    })

    revalidatePath(`/opportunities/${params.id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/opportunities"
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            ← Back to Opportunities
          </Link>
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Opportunity</h1>
            <form action={markOpportunityLost}>
              <button
                type="submit"
                className="rounded-md border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Mark Lost
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Lead</h3>
              {opportunity.lead_id ? (
                <Link
                  href={`/leads/${opportunity.lead_id}`}
                  className="mt-1 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {opportunity.leads?.homeowner_name || 'View lead'}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-gray-900">
                  {opportunity.leads?.homeowner_name || 'N/A'}
                </p>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Status</h3>
              <p className="mt-1 text-sm text-gray-900 capitalize">
                {opportunity.status.replace('_', ' ')}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Type</h3>
              <p className="mt-1 text-sm text-gray-900 capitalize">
                {opportunity.project_type}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Address</h3>
              <p className="mt-1 text-sm text-gray-900">{opportunity.address_text || 'N/A'}</p>
            </div>
          </div>
        </div>

        {/* Roof Measurements Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Roof Measurements</h2>
            <div className="flex gap-2">
              {measureToolEnabled && (
                <Link
                  href={`/tools/roof-measure?opportunity_id=${params.id}&address=${encodeURIComponent(opportunity.address_text || '')}`}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Measure Roof
                </Link>
              )}
            </div>
          </div>
          
          {measurements && measurements.length > 0 ? (
            <div className="space-y-3">
              {measurements.map((measurement: any) => (
                <div
                  key={measurement.id}
                  className="p-4 border rounded-lg bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          measurement.source === 'in_house' ? 'bg-indigo-100 text-indigo-700' :
                          measurement.source === 'eagleview' ? 'bg-orange-100 text-orange-700' :
                          measurement.source === 'roofr' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {measurement.source === 'in_house' ? 'ARX Measure' : 
                           measurement.source.charAt(0).toUpperCase() + measurement.source.slice(1)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          measurement.status === 'completed' ? 'bg-green-100 text-green-700' :
                          measurement.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {measurement.status.charAt(0).toUpperCase() + measurement.status.slice(1)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(measurement.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">
                        {measurement.total_squares?.toFixed(1) || '—'}
                      </p>
                      <p className="text-xs text-gray-500">squares</p>
                    </div>
                  </div>
                  {measurement.status === 'completed' && (
                    <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Area:</span>
                        <span className="ml-1 font-medium">{measurement.total_area_sqft?.toLocaleString() || '—'} sqft</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Pitch:</span>
                        <span className="ml-1 font-medium">{measurement.predominant_pitch || '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Facets:</span>
                        <span className="ml-1 font-medium">{measurement.facet_count || '—'}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <p className="text-gray-500 text-sm mb-3">No roof measurements yet</p>
              {measureToolEnabled ? (
                <Link
                  href={`/tools/roof-measure?opportunity_id=${params.id}&address=${encodeURIComponent(opportunity.address_text || '')}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Measure with ARX Tool
                </Link>
              ) : (
                <p className="text-gray-400 text-xs">
                  In-house measurement tool is disabled. Use external integrations.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Design</h2>
          {designPdfUrl ? (
            <div className="mb-4 text-sm">
              <a
                href={designPdfUrl}
                className="text-indigo-600 hover:text-indigo-800"
                target="_blank"
                rel="noreferrer"
              >
                View current design PDF →
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-4">No design PDF uploaded yet.</p>
          )}
          <form
            action={uploadDesignPdf}
            className="flex flex-wrap items-center gap-3"
            encType="multipart/form-data"
          >
            <input type="file" name="design_pdf" accept="application/pdf" required />
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Upload Design PDF
            </button>
          </form>
        </div>

        {/* Proposals Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Proposals</h2>
            <Link
              href={`/proposals/builder?opportunity_id=${params.id}&customer_name=${encodeURIComponent(opportunity.leads?.homeowner_name || '')}&customer_address=${encodeURIComponent(opportunity.address_text || '')}`}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Proposal
            </Link>
          </div>
          
          {proposals && proposals.length > 0 ? (
            <div className="space-y-3">
              {proposals.map((proposal: any) => (
                <Link
                  key={proposal.id}
                  href={`/proposals/${proposal.id}`}
                  className="block p-4 border rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{proposal.proposal_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          proposal.status === 'draft' ? 'bg-gray-100 text-gray-700' :
                          proposal.status === 'sent' ? 'bg-blue-100 text-blue-700' :
                          proposal.status === 'viewed' ? 'bg-amber-100 text-amber-700' :
                          proposal.status === 'accepted' ? 'bg-green-100 text-green-700' :
                          proposal.status === 'declined' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {proposal.status.charAt(0).toUpperCase() + proposal.status.slice(1)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{proposal.title || 'Untitled Proposal'}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        Created {new Date(proposal.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-indigo-600">
                        ${(proposal.total || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm mb-3">No proposals created yet</p>
              <Link
                href={`/proposals/builder?opportunity_id=${params.id}&customer_name=${encodeURIComponent(opportunity.leads?.homeowner_name || '')}&customer_address=${encodeURIComponent(opportunity.address_text || '')}`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
              >
                Create First Proposal
              </Link>
            </div>
          )}
        </div>

        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Signed Contract</h2>
          <p className="text-sm text-gray-500 mb-4">
            Upload the signed contract to convert this opportunity into a project.
          </p>
          <form
            action={uploadSignedContract}
            className="flex flex-wrap items-center gap-3"
            encType="multipart/form-data"
          >
            <input type="file" name="signed_contract" required />
            <button
              type="submit"
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
            >
              Upload Signed Contract
            </button>
          </form>
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
            <h2 className="text-xl font-bold text-gray-900 mb-4">Files</h2>
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
    </div>
  )
}
