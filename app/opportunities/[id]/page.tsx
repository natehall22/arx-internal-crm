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
import CloseAppointmentStatusSection from '@/components/opportunities/CloseAppointmentStatusSection'
import DeleteRoofMeasurementButton from '@/components/opportunities/DeleteRoofMeasurementButton'
import DeleteProposalButton from '@/components/opportunities/DeleteProposalButton'
import DesignPdfUpload from '@/components/opportunities/DesignPdfUpload'
import InspectionResultReadOnlyCard from '@/components/inspection/InspectionResultReadOnlyCard'
import CopyShareLinkButton from '@/components/inspection-report/CopyShareLinkButton'
import { resolveCloseOutcomeLabel, type CloseOutcomeConfigRow } from '@/lib/close-outcomes'
import { resolveOpsAccess } from '@/lib/ops-access'
import {
  getInspectionOutcomeConfig,
  normalizeInspectionOutcomeRows,
} from '@/lib/inspection-outcomes'
import OpportunityQueueSidebar from '@/components/opportunities/OpportunityQueueSidebar'
import InsideSalesFollowUpDrawer from '@/components/opportunities/InsideSalesFollowUpDrawer'
import {
  canViewInsideSalesFollowUp,
  getInsideSalesCallability,
  getInsideSalesFollowUpKind,
  getInsideSalesFollowUpStatus,
  hasRepWorkingHandoffFollowUp,
  hasActiveInsideSalesFollowUp,
  isInsideSalesRoleLike,
} from '@/lib/inside-sales-follow-up'
import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { isOrgSuperuserRoleSlug, isBarredFromSalesDocAccess } from '@/lib/permissions'
import {
  mapLatestInspectionByLeadId,
  mapLatestInspectionByOpportunityId,
  withEffectiveInspectionFields,
} from '@/lib/effective-inspection-state'
import {
  buildOpportunityListQuery,
  filtersFromSearchParams,
} from '@/lib/opportunity-list-filters'

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const { authUser, profile } = await requireAuth()
  const queueFilters = filtersFromSearchParams(searchParams || {})
  const queueQueryString = buildOpportunityListQuery(queueFilters)
  const queueEnabled = String(searchParams?.queue || '') === '1'
  const insideSalesView = String(searchParams?.view || '') === 'inside_sales'
  const backParams = new URLSearchParams(queueQueryString)
  if (insideSalesView) {
    backParams.set('view', 'inside_sales')
  }
  const backHref = backParams.toString() ? `/opportunities?${backParams.toString()}` : '/opportunities'
  // Use service client to bypass RLS
  const supabase = createServiceClient()
  const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  const opportunityQuery = supabase
    .from('opportunities')
    .select('*, customers(*), leads(*)')
    .eq('id', params.id)
    .eq('org_id', profile.org_id)

  const { data: opportunity } = await opportunityQuery.single()

  if (!opportunity) {
    notFound()
  }

  let viewerCustomRole: { name: string | null; display_name: string | null } | null = null
  if (profile.custom_role_id) {
    const { data: customRoleData } = await supabase
      .from('custom_roles')
      .select('name, display_name')
      .eq('id', profile.custom_role_id)
      .maybeSingle()
    viewerCustomRole = customRoleData
  }

  const { permissionNames: viewerPermissionNames } = await resolveEffectivePermissionNames(
    supabase,
    authUser.id,
    { role: profile.role, custom_role_id: profile.custom_role_id }
  )

  const insideSalesAccessInput = {
    role: profile.role,
    customRoleName: viewerCustomRole?.name || null,
    customRoleDisplayName: viewerCustomRole?.display_name || null,
    permissionNames: viewerPermissionNames,
  }

  // Closer on opportunities: display from linked lead (source of truth for assigned rep)
  const leadRow = opportunity.leads
    ? Array.isArray(opportunity.leads)
      ? opportunity.leads[0]
      : opportunity.leads
    : null
  const closerUserIdFromLead = leadRow?.closer_user_id ?? null

  // Setter: opportunity.setter_user_id is source of truth.
  // Fall back to lead.owner_user_id for older records where setter_user_id was not populated.
  const setterUserId = opportunity.setter_user_id ?? leadRow?.owner_user_id ?? null

  const repLikeRoles = ['rep', 'sales_rep', 'closer'] as const
  const setterLikeRoles = ['setter', 'canvasser'] as const
  const isSetterLikeViewer = setterLikeRoles.includes(
    profile.role as (typeof setterLikeRoles)[number]
  )
  // Setter-like base roles are gated below once queue state is known — call-center workers on a
  // permission-based Inside Sales custom role (e.g. base role 'setter'/'canvasser' + call_center_rep)
  // may open records in their working scope; everyone else setter-like gets notFound().
  const isInsideSalesWorker = isInsideSalesRoleLike(insideSalesAccessInput)
  const isSalesDocBarredViewer = isBarredFromSalesDocAccess(insideSalesAccessInput)
  if (isSetterLikeViewer && !isInsideSalesWorker) {
    notFound()
  }

  if (repLikeRoles.includes(profile.role as (typeof repLikeRoles)[number])) {
    const isOwner = opportunity.owner_user_id === profile.id
    const isSetter = setterUserId === profile.id
    const isLeadCloser = closerUserIdFromLead === profile.id
    if (!isOwner && !isSetter && !isLeadCloser) {
      notFound()
    }
  }

  // Fetch setter info
  let setter = null
  if (setterUserId) {
    const { data: setterData } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('id', setterUserId)
      .maybeSingle()
    setter = setterData
  }

  let closer = null
  if (closerUserIdFromLead) {
    const { data: closerData } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('id', closerUserIdFromLead)
      .single()
    closer = closerData
  }

  let assignedInsideSalesName: string | null = null
  if (opportunity.assigned_user_id) {
    const { data: assigneeRow } = await supabase
      .from('users')
      .select('full_name')
      .eq('id', opportunity.assigned_user_id)
      .maybeSingle()
    assignedInsideSalesName = assigneeRow?.full_name ?? null
  }

  const customerName = leadRow?.homeowner_name || opportunity.customers?.name || 'Unknown Customer'
  const customerPhone = leadRow?.phone || opportunity.customers?.phone || opportunity.contact_phone || null

  const [{ data: inspectionUpdates }, { data: leadInspectionRowsForMerge }, { data: orgSettings }] = await Promise.all([
    supabase
      .from('inspection_status_updates')
      .select('*')
      .eq('opportunity_id', params.id)
      .order('created_at', { ascending: false }),
    opportunity.lead_id
      ? supabase
          .from('inspection_status_updates')
          .select('opportunity_id, lead_id, outcome, notes, created_at')
          .eq('lead_id', opportunity.lead_id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('orgs').select('settings').eq('id', profile.org_id).single(),
  ])

  const inspectionOutcomeSettings = orgSettings?.settings?.inspection_outcomes

  const inspectionByOpportunityId = mapLatestInspectionByOpportunityId(inspectionUpdates || [])
  const inspectionByLeadId = mapLatestInspectionByLeadId(leadInspectionRowsForMerge || [])
  const opportunityForInspectionUi = withEffectiveInspectionFields(
    opportunity as any,
    inspectionByOpportunityId,
    inspectionByLeadId
  )

  const hasInsideSalesFollowUp = hasActiveInsideSalesFollowUp(
    opportunityForInspectionUi,
    inspectionOutcomeSettings
  )

  // Inside-sales workers may only open records in their working scope: an active queue item
  // (the conveyor serves unassigned org-wide items), a record they own or are assigned, or an
  // inbound-channel lead (mirrors /api/leads scoping). Everything else 404s.
  if (isInsideSalesWorker) {
    const insideSalesRecordInScope =
      hasInsideSalesFollowUp ||
      opportunity.owner_user_id === profile.id ||
      opportunity.assigned_user_id === profile.id ||
      leadRow?.channel === 'inbound'
    if (!insideSalesRecordInScope) {
      notFound()
    }
  }

  const insideSalesFollowUpKind = getInsideSalesFollowUpKind(
    opportunityForInspectionUi,
    inspectionOutcomeSettings
  )
  const hasRepWorkingHandoffGrace = hasRepWorkingHandoffFollowUp(
    opportunityForInspectionUi,
    inspectionOutcomeSettings
  )
  const canViewInsideSalesQueue = hasInsideSalesFollowUp
    ? canViewInsideSalesFollowUp(insideSalesAccessInput)
    : false
  const canSelfAssignInsideSalesDetail = isInsideSalesRoleLike(insideSalesAccessInput)
  const handoffGraceDeadlineLabel =
    hasRepWorkingHandoffGrace && opportunity.follow_up_at
      ? new Date(opportunity.follow_up_at).toLocaleString()
      : null

  const inspectionRowsForBanner = normalizeInspectionOutcomeRows(inspectionOutcomeSettings)
  const handoffInspectionLabel =
    insideSalesFollowUpKind === 'handoff'
      ? getInspectionOutcomeConfig(
          inspectionRowsForBanner,
          opportunityForInspectionUi.inspection_outcome
        )?.label ?? null
      : null

  const insideSalesCallability = hasInsideSalesFollowUp
    ? getInsideSalesCallability(opportunityForInspectionUi as any, inspectionOutcomeSettings)
    : null
  const insideSalesFollowUpStatusForDrawer = hasInsideSalesFollowUp
    ? getInsideSalesFollowUpStatus(opportunityForInspectionUi as any, inspectionOutcomeSettings)
    : null

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

  // Pricing/sales-doc data — skip fetches for inside-sales workers (not rendered; avoids SSR leakage)
  let proposals: any[] | null = null
  let measurements: any[] | null = null
  let acceptedProposal: {
    id: string
    total: number | null
    financed_contract_total: number | null
    financing_lender_name: string | null
    scope_of_work: string | null
  } | null = null
  let orderFormContracts: any[] | null = null

  if (!isSalesDocBarredViewer) {
    const [{ data: proposalRows }, { data: measurementRows }, { data: acceptedRow }] = await Promise.all([
      supabase
        .from('proposals')
        .select('id, proposal_number, title, status, total, created_at, created_by')
        .eq('opportunity_id', params.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('roof_measurements')
        .select('id, source, status, total_area_sqft, total_squares, predominant_pitch, facet_count, created_at')
        .eq('opportunity_id', params.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('proposals')
        .select('id, total, financed_contract_total, financing_lender_name, scope_of_work')
        .eq('opportunity_id', params.id)
        .eq('status', 'accepted')
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    proposals = proposalRows
    measurements = measurementRows
    acceptedProposal = acceptedRow

    try {
      const { data } = await supabase
        .from('order_form_contracts')
        .select('id, status, signing_token, customer_signed_at, pdf_url, created_at, agreement_type')
        .eq('opportunity_id', params.id)
        .order('created_at', { ascending: false })
      orderFormContracts = data
    } catch (e) {
      // Table may not exist yet - migration not run
      console.log('order_form_contracts table not available')
    }
  }

  // Latest customer-facing roof report (photo documentation PDF) — photo count joined
  // so this stays a single round trip on a hot page
  const { data: inspectionReport } = await supabase
    .from('inspection_reports')
    .select(
      'id, status, share_token, pdf_generated_at, pdf_size_bytes, last_sent_to, last_sent_at, updated_at, inspection_report_photos(count)'
    )
    .eq('opportunity_id', params.id)
    .eq('org_id', profile.org_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const inspectionReportPhotoCount =
    (inspectionReport?.inspection_report_photos as { count: number }[] | undefined)?.[0]?.count ?? 0

  // Org settings (measure tool + inspection outcomes for inside-sales eligibility)
  const measureToolEnabled = orgSettings?.settings?.measure_tool_enabled !== false // Default to enabled

  // Fetch the most recent inspection appointment linked to this opportunity
  const { data: inspectionAppointment } = await supabase
    .from('scheduled_appointments')
    .select('id')
    .eq('opportunity_id', params.id)
    .eq('org_id', profile.org_id)
    .eq('appointment_type', 'inspection')
    .order('scheduled_for', { ascending: false })
    .limit(1)
    .maybeSingle()

  let closeScheduledFor: string | null = null
  let closeOutcome: string | null = null
  let closeOutcomeSubmittedAt: string | null = null
  let closeAppointmentId: string | null = null
  let closeScheduledAppointmentId: string | null = null

  const { data: closeAppointmentRow, error: closeAppointmentError } = await supabase
    .from('close_appointments')
    .select('id, scheduled_for, outcome, outcome_submitted_at, scheduled_appointment_id')
    .eq('opportunity_id', params.id)
    .eq('org_id', profile.org_id)
    .order('scheduled_for', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (closeAppointmentError) {
    console.warn('close_appointments:', closeAppointmentError.message)
  }

  if (closeAppointmentRow) {
    closeScheduledFor = closeAppointmentRow.scheduled_for
    closeOutcome = closeAppointmentRow.outcome
    closeOutcomeSubmittedAt = closeAppointmentRow.outcome_submitted_at
    closeAppointmentId = closeAppointmentRow.id
    closeScheduledAppointmentId = closeAppointmentRow.scheduled_appointment_id
  } else {
    const { data: scheduledClose } = await supabase
      .from('scheduled_appointments')
      .select('id, scheduled_for')
      .eq('opportunity_id', params.id)
      .eq('org_id', profile.org_id)
      .eq('appointment_type', 'close')
      .order('scheduled_for', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (scheduledClose) {
      closeScheduledFor = scheduledClose.scheduled_for
      closeScheduledAppointmentId = scheduledClose.id
    }
  }

  const closeOutcomeDisplayLabel =
    closeOutcome
      ? resolveCloseOutcomeLabel(
          closeOutcome,
          orgSettings?.settings?.close_outcomes as CloseOutcomeConfigRow[] | undefined
        )
      : null

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

  // Compute "next step" guidance server-side based on current state
  const opportunityStatusColors: Record<string, string> = {
    open: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-purple-100 text-purple-800',
    negotiation: 'bg-orange-100 text-orange-800',
    won: 'bg-green-100 text-green-800',
    lost: 'bg-red-100 text-red-800',
  }
  const opportunityStatusBand: Record<string, string> = {
    open: 'bg-blue-400',
    in_progress: 'bg-purple-500',
    negotiation: 'bg-orange-400',
    won: 'bg-green-500',
    lost: 'bg-red-400',
  }

  type NextStep = {
    icon: string
    title: string
    body: string
    bg: string
    titleColor: string
    link?: string
    linkLabel?: string
    secondaryLink?: string
    secondaryLabel?: string
    /** Render Mark as Lost in the banner (same server action as footer) */
    showMarkLost?: boolean
  }
  let nextStep: NextStep | null = null

  const proposalBuilderUrl = `/proposals/builder?opportunity_id=${params.id}&customer_name=${encodeURIComponent(customerName || '')}&customer_address=${encodeURIComponent(opportunity.address_text || '')}`

  // Direct link to the inspection feedback form (avoids two-hop: banner → section → button)
  const inspectionFeedbackUrl =
    inspectionAppointment?.id && leadRow?.id
      ? `/appointments/feedback?id=${inspectionAppointment.id}&lead_id=${leadRow.id}`
      : leadRow?.id
        ? `/appointments/feedback?lead_id=${leadRow.id}`
        : '#inspection-section'

  // Only hide the empty debrief card when the banner links straight to feedback; if we fall back to the
  // in-page anchor (no lead), the card must still show instructions / "link a lead".
  const hideInspectionEmptyCard = inspectionFeedbackUrl !== '#inspection-section'

  // Flow: Inspection → Close Appointment → Contract → Won/Lost
  if (opportunity.status === 'won') {
    nextStep = { icon: '🎉', title: 'Deal Won!', body: 'Check the Job Board to track production progress.', bg: 'bg-green-50 border-green-200', titleColor: 'text-green-800', link: '/ops', linkLabel: 'Go to Job Board' }
  } else if (opportunity.status === 'lost') {
    nextStep = { icon: '📋', title: 'Marked as Lost', body: 'You can still follow up or reopen this opportunity if the customer comes back.', bg: 'bg-gray-50 border-gray-200', titleColor: 'text-gray-700' }
  } else if (!opportunityForInspectionUi.inspection_outcome) {
    // Step 1 — no inspection result yet
    nextStep = { icon: '🔍', title: 'Inspection Needed', body: 'Run the inspection and submit your results below.', bg: 'bg-blue-50 border-blue-200', titleColor: 'text-blue-800', link: inspectionFeedbackUrl, linkLabel: 'Submit Inspection' }
  } else if (
    opportunityForInspectionUi.inspection_outcome === 'not_home' &&
    hasInsideSalesFollowUp &&
    insideSalesFollowUpKind === 'didnt_sit'
  ) {
    nextStep = {
      icon: '📞',
      title: 'Inside sales — your turn',
      body:
        'Customer did not sit. You can dial now — log calls or texts from the panel below or the Inside Sales queue, then reschedule when ready.',
      bg: 'bg-amber-50 border-amber-200',
      titleColor: 'text-amber-900',
      ...(canViewInsideSalesQueue
        ? {
            link: `/opportunities?view=inside_sales&q=${encodeURIComponent(customerName)}`,
            linkLabel: 'Open Inside Sales queue',
          }
        : {}),
    }
  } else if (
    hasRepWorkingHandoffGrace &&
    !hasInsideSalesFollowUp
  ) {
    nextStep = {
      icon: '🛡️',
      title: 'Rep Working Follow-Up',
      body: handoffGraceDeadlineLabel
        ? `The rep can keep working this follow-up until ${handoffGraceDeadlineLabel}. If it is still unresolved after that, inside sales takes over.`
        : 'The rep can keep working this follow-up for a limited grace period before inside sales takes over.',
      bg: 'bg-violet-50 border-violet-200',
      titleColor: 'text-violet-900',
    }
  } else if (
    hasInsideSalesFollowUp &&
    insideSalesFollowUpKind === 'knockback'
  ) {
    const knockbackReasonLabel = (opportunity as { knockback_reason?: string | null }).knockback_reason
      ?.replace(/_/g, ' ')
    const followUpLabel = opportunity.follow_up_at
      ? new Date(opportunity.follow_up_at).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null
    const cal = insideSalesCallability
    const callableNow = cal?.callableNow ?? true
    if (callableNow) {
      nextStep = {
        icon: '📞',
        title: 'Inside sales — knockback due',
        body: knockbackReasonLabel
          ? `Follow-up queue (${knockbackReasonLabel}). Ok to call now — log touches below or from Inside Sales.${followUpLabel ? ` Scheduled follow-up: ${followUpLabel} ET.` : ''}`
          : `Follow-up queue. Ok to call now — log touches below or from Inside Sales.${followUpLabel ? ` Scheduled follow-up: ${followUpLabel} ET.` : ''}`,
        bg: 'bg-amber-50 border-amber-200',
        titleColor: 'text-amber-900',
        ...(canViewInsideSalesQueue
          ? {
              link: '/inside-sales',
              linkLabel: 'Open Inside Sales',
            }
          : {}),
      }
    } else {
      nextStep = {
        icon: '⏳',
        title: 'Inside sales — knockback scheduled',
        body: followUpLabel
          ? `Follow-up opens ${followUpLabel} ET.${knockbackReasonLabel ? ` Reason: ${knockbackReasonLabel}.` : ''}`
          : 'Follow-up is scheduled for a future date. Review notes and call when the date arrives.',
        bg: 'bg-violet-50 border-violet-200',
        titleColor: 'text-violet-900',
        ...(canViewInsideSalesQueue
          ? {
              link: '/inside-sales',
              linkLabel: 'Open Inside Sales',
            }
          : {}),
      }
    }
  } else if (
    hasInsideSalesFollowUp &&
    insideSalesFollowUpKind === 'handoff'
  ) {
    const cal = insideSalesCallability
    const callableNow = cal?.callableNow ?? true
    const opensLabel =
      cal?.eligibleAtIso &&
      new Date(cal.eligibleAtIso).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    const delayPhrase =
      cal?.adminHandoffDelayDays != null
        ? `Admin timing: ${cal.adminHandoffDelayDays} days after inspection.`
        : ''

    if (callableNow) {
      nextStep = {
        icon: '📞',
        title: 'Inside sales — your turn',
        body: handoffInspectionLabel
          ? `Ok to call now (${handoffInspectionLabel}). Log touches below or from the queue, then schedule back when the customer is ready.`
          : 'Ok to call now. Log touches below or from the queue, then schedule back when the customer is ready.',
        bg: 'bg-amber-50 border-amber-200',
        titleColor: 'text-amber-900',
        ...(canViewInsideSalesQueue
          ? {
              link: `/opportunities?view=inside_sales&q=${encodeURIComponent(customerName)}`,
              linkLabel: 'Open Inside Sales queue',
            }
          : {}),
      }
    } else {
      nextStep = {
        icon: '⏳',
        title: 'Inside sales — call opens soon',
        body:
          opensLabel && delayPhrase
            ? `Still in the admin wait window. Calls open ${opensLabel}. ${delayPhrase}`
            : opensLabel
              ? `Calls open ${opensLabel}. Review notes now; dialing starts once this time passes.${delayPhrase ? ` ${delayPhrase}` : ''}`
              : `Timing follows your org rules from the inspection outcome. Review notes and check back, or ask a manager if this looks off.${delayPhrase ? ` ${delayPhrase}` : ''}`,
        bg: 'bg-violet-50 border-violet-200',
        titleColor: 'text-violet-900',
        ...(canViewInsideSalesQueue
          ? {
              link: `/opportunities?view=inside_sales&q=${encodeURIComponent(customerName)}`,
              linkLabel: 'Open Inside Sales queue',
            }
          : {}),
      }
    }
  } else if (opportunityForInspectionUi.inspection_outcome === 'rescheduled' || opportunityForInspectionUi.inspection_outcome === 'not_home') {
    // Inspection couldn't happen — needs reschedule
    const rescheduleHref = inspectionAppointment?.id
      ? `/schedule?reschedule=${inspectionAppointment.id}`
      : '/calendar'
    nextStep = {
      icon: '📞',
      title: 'Reschedule the Inspection',
      body: 'The customer was not home or requested a new time. Reschedule the appointment or use the calendar to get it back on the board.',
      bg: 'bg-yellow-50 border-yellow-200',
      titleColor: 'text-yellow-800',
      link: rescheduleHref,
      linkLabel: inspectionAppointment?.id ? 'Reschedule inspection' : 'Open calendar',
      secondaryLink: '/calendar',
      secondaryLabel: 'Team calendar',
    }
  } else if (['said_no', 'insurance_follow_up', 'failed_credit'].includes(opportunityForInspectionUi.inspection_outcome || '')) {
    // Stalled — offer follow-up close, calendar, and mark lost in-banner
    nextStep = {
      icon: '💬',
      title: 'Follow Up With the Customer',
      body: 'The deal is stalled. Schedule a follow-up close, use the calendar to book time, or mark the opportunity lost if they are not moving ahead.',
      bg: 'bg-red-50 border-red-200',
      titleColor: 'text-red-800',
      link: '#close-section',
      linkLabel: 'Schedule follow-up (close)',
      secondaryLink: '/calendar',
      secondaryLabel: 'Open calendar',
      showMarkLost: true,
    }
  } else if (!isSalesDocBarredViewer) {
    // Inspection ran — determine where we are in the proposal → close → contract flow
    if (!proposals || proposals.length === 0) {
      // Step 2 — need a proposal to bring to the close
      nextStep = { icon: '📝', title: 'Create a Proposal', body: 'Inspection is done — build a proposal to bring to the close appointment.', bg: 'bg-indigo-50 border-indigo-200', titleColor: 'text-indigo-800', link: proposalBuilderUrl, linkLabel: 'Build Proposal' }
    } else if (!closeScheduledFor) {
      // Step 3 — proposal exists, need to schedule the close
      nextStep = { icon: '📅', title: 'Schedule the Close', body: 'Proposal is ready. Schedule the close appointment to sit down with the customer.', bg: 'bg-purple-50 border-purple-200', titleColor: 'text-purple-800', link: '#close-section', linkLabel: 'Schedule Close' }
    } else if (!orderFormContracts || orderFormContracts.length === 0) {
      // Step 4 — close is scheduled/ran, create the contract
      nextStep = { icon: '✍️', title: 'Create the Contract', body: closeOutcome ? 'The close ran — generate the order form for the customer to sign.' : 'Close is coming up. Have the contract ready to send once the customer says yes.', bg: 'bg-emerald-50 border-emerald-200', titleColor: 'text-emerald-800', link: '#contract-section', linkLabel: 'Create Contract' }
    } else {
      // Step 6 — contract exists, waiting on signature (or all signed — prompt to close the loop in CRM)
      const pendingContract = orderFormContracts.find((c: any) => c.status !== 'completed')
      if (pendingContract) {
        nextStep = { icon: '⏳', title: 'Waiting for Customer Signature', body: 'Contract is out. Follow up with the customer to get it signed.', bg: 'bg-purple-50 border-purple-200', titleColor: 'text-purple-800', link: '#contract-section', linkLabel: 'View Contract' }
      } else {
        nextStep = {
          icon: '✅',
          title: 'Contract Complete',
          body: 'Paperwork is signed. Mark the opportunity Won when the job is sold, or review the close section if anything is still pending.',
          bg: 'bg-green-50 border-green-200',
          titleColor: 'text-green-800',
          link: '#close-section',
          linkLabel: 'Review close',
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Nav />
      <div className={`${queueEnabled ? 'max-w-7xl' : 'max-w-5xl'} mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8`}>
        <div className={queueEnabled ? 'xl:flex xl:items-start xl:gap-6' : ''}>
          {queueEnabled && (
            <OpportunityQueueSidebar
              currentOpportunityId={params.id}
              filters={queueFilters}
            />
          )}

          <div className={queueEnabled ? 'min-w-0 flex-1' : ''}>
            <div className="mb-4 sm:mb-6">
              <Link
                href={backHref}
                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
              >
                {insideSalesView
                  ? '← Back to Inside Sales'
                  : queueEnabled
                    ? '← Back to Filtered Opportunities'
                    : '← Back to Opportunities'}
              </Link>
            </div>

        {/* Header card — customer name as title */}
        <div className="bg-white shadow rounded-xl overflow-hidden mb-4 sm:mb-6">
          {/* Status color band */}
          <div className={`h-1.5 ${opportunityStatusBand[opportunity.status] || 'bg-gray-300'}`} />
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900 break-words">{customerName}</h1>
                <p className="text-gray-500 mt-0.5 text-sm sm:text-base break-words">{opportunity.address_text || 'No address'}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full capitalize ${
                    opportunityStatusColors[opportunity.status] || 'bg-gray-100 text-gray-800'
                  }`}>
                    {opportunity.status.replace(/_/g, ' ')}
                  </span>
                  <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-gray-100 text-gray-700 capitalize">
                    {opportunity.project_type || '—'}
                  </span>
                  {hasRepWorkingHandoffGrace && !hasInsideSalesFollowUp && (
                    <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-violet-100 text-violet-800">
                      Rep working (grace)
                    </span>
                  )}
                  {hasInsideSalesFollowUp && insideSalesFollowUpKind && (
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                        insideSalesFollowUpKind === 'knockback'
                          ? insideSalesCallability && !insideSalesCallability.callableNow
                            ? 'bg-violet-100 text-violet-800'
                            : 'bg-orange-100 text-orange-900'
                          : insideSalesFollowUpKind === 'handoff' &&
                              insideSalesCallability &&
                              !insideSalesCallability.callableNow
                            ? 'bg-violet-100 text-violet-800'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {insideSalesFollowUpKind === 'knockback'
                        ? insideSalesCallability && !insideSalesCallability.callableNow
                          ? `Knockback · Opens ${insideSalesCallability.eligibleAtIso ? new Date(insideSalesCallability.eligibleAtIso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'soon'}`
                          : `Knockback · Ready for you`
                        : insideSalesFollowUpKind === 'didnt_sit'
                          ? "Didn't sit · Ready for you"
                          : insideSalesCallability && !insideSalesCallability.callableNow
                            ? `${handoffInspectionLabel || 'Handoff'} · Opens ${insideSalesCallability.eligibleAtIso ? new Date(insideSalesCallability.eligibleAtIso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'soon'}`
                            : `${handoffInspectionLabel || 'Handoff'} · Ready for you`}
                    </span>
                  )}
                </div>
              </div>
              {isOrgSuperuserRoleSlug(profile.role) && (
                <div className="shrink-0">
                  <DeleteOpportunityButton
                    opportunityId={params.id}
                    customerName={customerName}
                  />
                </div>
              )}
            </div>

            {/* Info grid — compact */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 pt-4 border-t text-sm">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Setter</p>
                <p className="text-gray-900 mt-0.5">{setter?.full_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Closer</p>
                <p className="text-gray-900 mt-0.5">{closer?.full_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Customer</p>
                {opportunity.customer_id ? (
                  <>
                    <Link href={`/customers/${opportunity.customer_id}`} className="text-indigo-600 hover:text-indigo-800 mt-0.5 inline-block">
                      {opportunity.customers?.name || 'View'}
                    </Link>
                    <p className="text-gray-900 mt-0.5">
                      {leadRow?.phone || opportunity.customers?.phone || opportunity.contact_phone || '—'}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="mt-0.5">
                      <LinkCustomerButton sourceType="opportunity" sourceId={opportunity.id} className="" />
                    </div>
                    <p className="text-gray-900 mt-0.5">
                      {leadRow?.phone || opportunity.customers?.phone || opportunity.contact_phone || '—'}
                    </p>
                  </>
                )}
              </div>
              {opportunity.lead_id && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Lead</p>
                  <Link href={`/leads/${opportunity.lead_id}`} className="text-indigo-600 hover:text-indigo-800 mt-0.5 inline-block">
                    {leadRow?.homeowner_name || 'View lead'}
                  </Link>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
              {canJobBoard && (
                <Link
                  href={`/opportunities/${params.id}/measure`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
                >
                  Measure Exterior
                </Link>
              )}
              {measureToolEnabled && !isSalesDocBarredViewer && (
                <Link
                  href={`/tools/roof-measure?opportunity_id=${params.id}&address=${encodeURIComponent(opportunity.address_text || '')}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  Measure Roof
                </Link>
              )}
            </div>

            {/* Mark Lost — de-emphasized, at bottom of card */}
            {opportunity.status !== 'lost' && opportunity.status !== 'won' && (
              <div className="mt-4 pt-3 border-t flex justify-end">
                <form action={markOpportunityLost}>
                  <button
                    type="submit"
                    className="text-sm font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:border-red-200 hover:text-red-700 hover:bg-red-50/50 transition-colors"
                  >
                    Mark as lost
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Next Step Banner */}
        {nextStep && (
          <div className={`rounded-xl border p-4 mb-4 sm:mb-6 flex items-start gap-3 ${nextStep.bg}`}>
            <span className="text-2xl shrink-0">{nextStep.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm sm:text-base ${nextStep.titleColor}`}>{nextStep.title}</p>
              <p className="text-sm text-gray-600 mt-0.5">{nextStep.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {nextStep.link && (
                  <Link
                    href={nextStep.link}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 text-sm font-semibold rounded-lg shadow-sm hover:bg-gray-50 text-gray-900"
                  >
                    {nextStep.linkLabel || 'Take action'} →
                  </Link>
                )}
                {nextStep.secondaryLink && (
                  <Link
                    href={nextStep.secondaryLink}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-white/80 border border-gray-200 text-sm font-medium rounded-lg hover:bg-white text-gray-800"
                  >
                    {nextStep.secondaryLabel || 'More'} →
                  </Link>
                )}
                {nextStep.showMarkLost && opportunity.status !== 'lost' && opportunity.status !== 'won' && (
                  <form action={markOpportunityLost} className="inline">
                    <button
                      type="submit"
                      className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-lg border border-red-300 text-red-800 bg-white hover:bg-red-50 shadow-sm"
                    >
                      Mark as lost
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {hasInsideSalesFollowUp &&
          canViewInsideSalesQueue &&
          insideSalesFollowUpKind &&
          (insideSalesFollowUpKind === 'didnt_sit' ||
            insideSalesFollowUpKind === 'handoff' ||
            insideSalesFollowUpKind === 'knockback') && (
            <div className="mb-4 sm:mb-6">
              <InsideSalesFollowUpDrawer
                opportunityId={params.id}
                customerName={customerName}
                customerPhone={customerPhone}
                followUpKind={insideSalesFollowUpKind}
                handoffOutcomeLabel={handoffInspectionLabel}
                knockbackReason={(opportunity as { knockback_reason?: string | null }).knockback_reason ?? null}
                assignedToName={assignedInsideSalesName}
                statusLabel={String(insideSalesFollowUpStatusForDrawer || 'new').replace(/_/g, ' ')}
                nextFollowUpAt={opportunity.follow_up_at}
                closerNotes={opportunity.inspection_notes}
                callableNow={insideSalesCallability?.callableNow ?? true}
                eligibleAtIso={insideSalesCallability?.eligibleAtIso ?? null}
                adminHandoffDelayDays={insideSalesCallability?.adminHandoffDelayDays ?? null}
                visible
                canManage={canViewInsideSalesQueue}
                canSelfAssign={canSelfAssignInsideSalesDetail}
                activities={(activities || []).map((a: any) => ({
                  id: a.id,
                  type: a.type,
                  body: a.body,
                  created_at: a.created_at,
                  users: a.users,
                }))}
              />
            </div>
          )}

        {/* Canvass Notes Section */}
        {leadRow?.canvass_notes && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Canvass Notes</h2>
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{leadRow.canvass_notes}</p>
              <p className="text-xs text-gray-500 mt-2">
                Notes from initial canvass visit
              </p>
            </div>
          </div>
        )}

        {/* Inspection Feedback Section */}
        {(opportunityForInspectionUi.inspection_outcome || (inspectionUpdates && inspectionUpdates.length > 0)) && (
          <div className="bg-white shadow rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Inspection Feedback</h2>
            
            {opportunityForInspectionUi.inspection_outcome && (
              <div className="mb-4 p-4 rounded-lg bg-gray-50 border">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    opportunityForInspectionUi.inspection_outcome === 'sale' ? 'bg-green-100 text-green-700' :
                    opportunityForInspectionUi.inspection_outcome === 'said_no' ? 'bg-red-100 text-red-700' :
                    opportunityForInspectionUi.inspection_outcome === 'not_home' ? 'bg-yellow-100 text-yellow-700' :
                    opportunityForInspectionUi.inspection_outcome === 'needs_repair' ? 'bg-orange-100 text-orange-700' :
                    opportunityForInspectionUi.inspection_outcome === 'rescheduled' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {opportunityForInspectionUi.inspection_outcome === 'sale' ? '✓ Sale' :
                     opportunityForInspectionUi.inspection_outcome === 'said_no' ? 'Said No' :
                     opportunityForInspectionUi.inspection_outcome === 'not_home' ? 'Not Home' :
                     opportunityForInspectionUi.inspection_outcome === 'needs_repair' ? 'Needs Repair' :
                     opportunityForInspectionUi.inspection_outcome === 'rescheduled' ? 'Rescheduled' :
                     opportunityForInspectionUi.inspection_outcome}
                  </span>
                  {opportunityForInspectionUi.inspection_outcome_at && (
                    <span className="text-xs text-gray-500">
                      {new Date(opportunityForInspectionUi.inspection_outcome_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {opportunityForInspectionUi.inspection_notes && (
                  <p className="text-sm text-gray-700 mt-2">{opportunityForInspectionUi.inspection_notes}</p>
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

        <div id="inspection-section" className="scroll-mt-20">
          <InspectionResultReadOnlyCard
            opportunityId={params.id}
            leadId={leadRow?.id ?? null}
            inspectionAppointmentId={inspectionAppointment?.id ?? null}
            hideWhenEmpty={hideInspectionEmptyCard}
          />
        </div>

        {/* Roof Report — customer-facing photo documentation PDF */}
        <div id="roof-report-section" className="scroll-mt-20 bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold text-gray-900">Roof Report</h2>
            <Link
              href={`/opportunities/${params.id}/report`}
              prefetch={false}
              className="px-4 py-2 bg-[#B0904E] text-[#2B2A28] text-sm font-bold rounded-lg hover:brightness-105"
            >
              {inspectionReport ? 'Open Report Builder' : '📷 Start Roof Report'}
            </Link>
          </div>
          {inspectionReport ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-800">
              <span>
                <strong>{inspectionReportPhotoCount}</strong> photo{inspectionReportPhotoCount !== 1 ? 's' : ''}
              </span>
              {inspectionReport.pdf_generated_at ? (
                <span>
                  PDF built {new Date(inspectionReport.pdf_generated_at).toLocaleDateString()}
                  {inspectionReport.pdf_size_bytes
                    ? ` (${(inspectionReport.pdf_size_bytes / 1048576).toFixed(1)} MB)`
                    : ''}
                </span>
              ) : (
                <span className="text-amber-700 font-medium">No PDF built yet</span>
              )}
              {inspectionReport.last_sent_to ? (
                <span>
                  Sent to {inspectionReport.last_sent_to}
                  {inspectionReport.last_sent_at
                    ? ` on ${new Date(inspectionReport.last_sent_at).toLocaleDateString()}`
                    : ''}
                </span>
              ) : null}
              {inspectionReport.pdf_generated_at ? (
                <span className="flex gap-2 ml-auto">
                  <a
                    href={`/api/inspection-reports/${inspectionReport.id}/pdf?redirect=1`}
                    target="_blank"
                    rel="noopener"
                    className="px-4 py-2 border border-gray-300 text-gray-800 text-sm font-semibold rounded-lg hover:bg-gray-50"
                  >
                    View PDF
                  </a>
                  <CopyShareLinkButton shareToken={inspectionReport.share_token} />
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-700">
              Photo-documented inspection report the customer keeps and can hand to their insurance carrier.
              Prefilled from this opportunity — the rep just adds photos.
            </p>
          )}
        </div>

        {/* Roof Measurements + Design — hidden for inside-sales viewers (closer/ops territory) */}
        {!isSalesDocBarredViewer && (
        <>
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
                  <div className="flex items-center justify-between gap-3">
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
                    <div className="flex items-center gap-4 shrink-0">
                      <DeleteRoofMeasurementButton measurementId={measurement.id} />
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">
                          {measurement.total_squares?.toFixed(1) || '—'}
                        </p>
                        <p className="text-xs text-gray-500">squares</p>
                      </div>
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
          <DesignPdfUpload opportunityId={params.id} />
        </div>
        </>
        )}

        {/* Proposals Section — hidden for inside-sales viewers (pricing is closer territory) */}
        {!isSalesDocBarredViewer && (
        <div id="proposals-section" className="scroll-mt-20 bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Proposals</h2>
            <Link
              href={proposalBuilderUrl}
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
                <div
                  key={proposal.id}
                  className="flex items-stretch gap-2 border rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-all"
                >
                  <Link href={`/proposals/${proposal.id}`} className="flex-1 block p-4 min-w-0">
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
                      <div className="text-right shrink-0 ml-4">
                        <p className="text-lg font-bold text-indigo-600">
                          ${(proposal.total || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </Link>
                  <div className="flex items-center pr-2 border-l border-gray-100">
                    <DeleteProposalButton
                      proposalId={proposal.id}
                      proposalNumber={proposal.proposal_number}
                      status={proposal.status}
                      createdBy={proposal.created_by}
                      currentUserId={profile.id}
                      userRole={profile.role}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm mb-3">No proposals created yet</p>
              <Link
                href={proposalBuilderUrl}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
              >
                Create First Proposal
              </Link>
            </div>
          )}
        </div>
        )}

        {/* Contract Section — hidden for inside-sales viewers */}
        {!isSalesDocBarredViewer && (
        <>
        <div id="contract-section" className="scroll-mt-20 bg-white shadow rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Contract</h2>
            <CreateContractButton
              opportunityId={params.id}
              proposalId={acceptedProposal?.id}
              customerName={leadRow?.homeowner_name || opportunity.customers?.name || ''}
              customerEmail={leadRow?.email || opportunity.customers?.email || ''}
              customerPhone={leadRow?.phone || opportunity.customers?.phone || ''}
              projectAddress={opportunity.address_text || ''}
              projectCost={
                acceptedProposal?.financed_contract_total != null && acceptedProposal.financed_contract_total > 0
                  ? acceptedProposal.financed_contract_total
                  : acceptedProposal?.total || 0
              }
              defaultFinanceCompany={acceptedProposal?.financing_lender_name}
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
        </>
        )}

        <div id="close-section" className="scroll-mt-20">
          <CloseAppointmentStatusSection
            opportunityId={params.id}
            scheduledFor={closeScheduledFor}
            outcome={closeOutcome}
            outcomeLabel={closeOutcomeDisplayLabel}
            outcomeSubmittedAt={closeOutcomeSubmittedAt}
            closeAppointmentId={closeAppointmentId}
            scheduledAppointmentId={closeAppointmentId ? null : closeScheduledAppointmentId}
          />
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
      </div>
    </div>
  )
}
