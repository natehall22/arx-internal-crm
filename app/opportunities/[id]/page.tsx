export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import Nav from '@/components/Nav'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import ContractUpload from '@/components/ContractUpload'
import DeleteOpportunityButton from '@/components/DeleteOpportunityButton'
import LinkCustomerButton from '@/components/customers/LinkCustomerButton'
import CreateContractButton from '@/components/contracts/CreateContractButton'
import ContractListItem from '@/components/contracts/ContractListItem'

export default async function OpportunityDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const { profile } = await requireAuth()
  // Use service client to bypass RLS
  const supabase = createServiceClient()
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

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

  // Fetch setter info if setter_user_id exists
  let setter = null
  if (opportunity.setter_user_id) {
    const { data: setterData } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('id', opportunity.setter_user_id)
      .single()
    setter = setterData
  }

  // Fetch closer info if owner_user_id exists
  let closer = null
  if (opportunity.owner_user_id) {
    const { data: closerData } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('id', opportunity.owner_user_id)
      .single()
    closer = closerData
  }

  // Fetch inspection status updates (feedback history)
  const { data: inspectionUpdates } = await supabase
    .from('inspection_status_updates')
    .select('*')
    .eq('opportunity_id', params.id)
    .order('created_at', { ascending: false })

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

  // Fetch accepted proposal for contract creation
  const { data: acceptedProposal } = await supabase
    .from('proposals')
    .select('id, total, scope_of_work')
    .eq('opportunity_id', params.id)
    .eq('status', 'accepted')
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Fetch existing order form contracts (wrapped in try-catch in case table doesn't exist yet)
  let orderFormContracts: any[] | null = null
  try {
    const { data } = await supabase
      .from('order_form_contracts')
      .select('id, status, signing_token, customer_signed_at, pdf_url, created_at')
      .eq('opportunity_id', params.id)
      .order('created_at', { ascending: false })
    orderFormContracts = data
  } catch (e) {
    // Table may not exist yet - migration not run
    console.log('order_form_contracts table not available')
  }

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
            <div className="flex items-center gap-3">
              <form action={markOpportunityLost}>
                <button
                  type="submit"
                  className="rounded-md border border-amber-600 px-4 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-50"
                >
                  Mark Lost
                </button>
              </form>
              {profile.role === 'admin' && (
                <DeleteOpportunityButton 
                  opportunityId={params.id} 
                  customerName={opportunity.leads?.homeowner_name || opportunity.customers?.name}
                />
              )}
            </div>
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
            <div>
              <h3 className="text-sm font-medium text-gray-500">Setter</h3>
              <p className="mt-1 text-sm text-gray-900">{setter?.full_name || 'N/A'}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Closer</h3>
              <p className="mt-1 text-sm text-gray-900">{closer?.full_name || 'N/A'}</p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500">Customer</h3>
              {opportunity.customer_id ? (
                <Link
                  href={`/customers/${opportunity.customer_id}`}
                  className="mt-1 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                >
                  {opportunity.customers?.name || 'View customer'}
                </Link>
              ) : (
                <div className="mt-1">
                  <p className="text-sm text-gray-500">Not linked</p>
                  <LinkCustomerButton sourceType="opportunity" sourceId={opportunity.id} className="mt-1" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Canvass Notes Section */}
        {opportunity.leads?.canvass_notes && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Canvass Notes</h2>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{opportunity.leads.canvass_notes}</p>
              <p className="text-xs text-gray-500 mt-2">
                Notes from initial canvass visit
              </p>
            </div>
          </div>
        )}

        {/* Inspection Feedback Section */}
        {(opportunity.inspection_outcome || (inspectionUpdates && inspectionUpdates.length > 0)) && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Inspection Feedback</h2>
            
            {opportunity.inspection_outcome && (
              <div className="mb-4 p-4 rounded-lg bg-gray-50 border">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    opportunity.inspection_outcome === 'sale' ? 'bg-green-100 text-green-700' :
                    opportunity.inspection_outcome === 'said_no' ? 'bg-red-100 text-red-700' :
                    opportunity.inspection_outcome === 'not_home' ? 'bg-yellow-100 text-yellow-700' :
                    opportunity.inspection_outcome === 'needs_repair' ? 'bg-orange-100 text-orange-700' :
                    opportunity.inspection_outcome === 'rescheduled' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {opportunity.inspection_outcome === 'sale' ? '✓ Sale' :
                     opportunity.inspection_outcome === 'said_no' ? 'Said No' :
                     opportunity.inspection_outcome === 'not_home' ? 'Not Home' :
                     opportunity.inspection_outcome === 'needs_repair' ? 'Needs Repair' :
                     opportunity.inspection_outcome === 'rescheduled' ? 'Rescheduled' :
                     opportunity.inspection_outcome}
                  </span>
                  {opportunity.inspection_outcome_at && (
                    <span className="text-xs text-gray-500">
                      {new Date(opportunity.inspection_outcome_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {opportunity.inspection_notes && (
                  <p className="text-sm text-gray-700 mt-2">{opportunity.inspection_notes}</p>
                )}
              </div>
            )}

            {inspectionUpdates && inspectionUpdates.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-500">Feedback History</h3>
                {inspectionUpdates.map((update: any) => (
                  <div key={update.id} className="p-3 border rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        update.outcome === 'sale' ? 'bg-green-100 text-green-700' :
                        update.outcome === 'said_no' ? 'bg-red-100 text-red-700' :
                        update.outcome === 'not_home' ? 'bg-yellow-100 text-yellow-700' :
                        update.outcome === 'needs_repair' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {update.outcome}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(update.created_at).toLocaleString()}
                      </span>
                    </div>
                    {update.notes && (
                      <p className="text-sm text-gray-700 mb-2">
                        <span className="font-medium">Notes:</span> {update.notes}
                      </p>
                    )}
                    {update.setter_feedback && (
                      <p className="text-sm text-indigo-700 bg-indigo-50 p-2 rounded">
                        <span className="font-medium">Setter Feedback:</span> {update.setter_feedback}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

        {/* Contract Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Contract</h2>
            <CreateContractButton
              opportunityId={params.id}
              proposalId={acceptedProposal?.id}
              customerName={opportunity.leads?.homeowner_name || opportunity.customers?.name || ''}
              customerEmail={opportunity.leads?.email || opportunity.customers?.email || ''}
              customerPhone={opportunity.leads?.phone || opportunity.customers?.phone || ''}
              projectAddress={opportunity.address_text || ''}
              projectCost={acceptedProposal?.total || 0}
              totalSquares={opportunity.roof_squares || undefined}
              scopeOfWork={acceptedProposal?.scope_of_work || ''}
            />
          </div>

          {orderFormContracts && orderFormContracts.length > 0 ? (
            <div className="space-y-3">
              {orderFormContracts.map((contract: any) => (
                <ContractListItem key={contract.id} contract={contract} />
              ))}
            </div>
          ) : (
            <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm mb-2">No contracts created yet</p>
              <p className="text-xs text-gray-400">
                {acceptedProposal 
                  ? 'Click "Create Contract" to generate an order form for signing'
                  : 'Create and accept a proposal first, then create a contract'}
              </p>
            </div>
          )}

          </div>

        {/* Only show manual contract upload if no completed order form contract exists */}
        {!(orderFormContracts && orderFormContracts.some((c: any) => c.status === 'completed')) && (
          <ContractUpload opportunityId={params.id} />
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
            <h2 className="text-xl font-bold text-gray-900 mb-4">Files</h2>
            <div className="space-y-2">
              {files && files.length > 0 ? (
                files.map((file: any) => {
                  const fileUrl = `${supabaseUrl}/storage/v1/object/public/files/${file.storage_path}`
                  return (
                    <div key={file.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-100 rounded flex items-center justify-center">
                          {file.mime_type?.startsWith('image/') ? (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{file.file_name}</p>
                          <p className="text-xs text-gray-500 capitalize">{file.tag}</p>
                        </div>
                      </div>
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    </div>
                  )
                })
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
