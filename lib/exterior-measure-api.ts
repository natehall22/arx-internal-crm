import { createServiceClient } from '@/lib/supabase/service'
import { FILES_BUCKET, safeUploadFilename } from '@/lib/files/storage'

export type MeasureContext = {
  orgId: string
  opportunityId: string
  jobId: string | null
}

// Measuring is an ops-level task — reps should not be entering measurements.
// Matches the same role set as canAccessJobBoard in lib/permissions.ts.
const MEASURE_ALLOWED_ROLES = new Set(['admin', 'owner', 'operations'])

export function canAccessOpportunityMeasure(profile: { id: string; role: string }, _subject: Record<string, unknown>): boolean {
  return MEASURE_ALLOWED_ROLES.has(profile.role)
}

function numberOrZero(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function intOrZero(value: unknown): number {
  return Math.round(numberOrZero(value))
}

export function exteriorMeasureErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return fallback
}

export async function resolveOpportunityMeasureContext(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  opportunityId: string
): Promise<(MeasureContext & { subject: Record<string, unknown> }) | null> {
  const { data: opportunity } = await supabase
    .from('opportunities')
    .select('id, org_id, address_text, owner_user_id, setter_user_id, customers(id, name, phone, email), leads(id, homeowner_name, phone, email, owner_user_id, closer_user_id)')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .single()

  if (!opportunity) return null

  const { data: job } = await supabase
    .from('production_jobs')
    .select('id, job_number')
    .eq('org_id', orgId)
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    orgId,
    opportunityId,
    jobId: job?.id || null,
    subject: { ...opportunity, job },
  }
}

export async function resolveJobMeasureContext(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  jobId: string
): Promise<(MeasureContext & { subject: Record<string, unknown> }) | null> {
  const { data: job } = await supabase
    .from('production_jobs')
    .select('id, org_id, job_number, address_text, opportunity_id, customer:customers(id, name, phone, email), project:projects(id, opportunity_id, leads(id, homeowner_name, phone, email))')
    .eq('id', jobId)
    .eq('org_id', orgId)
    .single()

  if (!job) return null

  const project = Array.isArray(job.project) ? job.project[0] : job.project
  const opportunityId = job.opportunity_id || project?.opportunity_id || null
  if (!opportunityId) return null

  return {
    orgId,
    opportunityId,
    jobId: job.id,
    subject: job,
  }
}

export async function loadExteriorMeasure(
  supabase: ReturnType<typeof createServiceClient>,
  context: MeasureContext
) {
  const { data: report, error: reportError } = await supabase
    .from('job_measure_reports')
    .select('*')
    .eq('org_id', context.orgId)
    .eq('opportunity_id', context.opportunityId)
    .maybeSingle()

  if (reportError) throw reportError
  if (!report) return { report: null, elevations: [], photos: [] }

  const [{ data: elevations, error: elevationsError }, { data: openings, error: openingsError }, { data: photos, error: photosError }] =
    await Promise.all([
      supabase
        .from('job_measure_elevations')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('report_id', report.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('job_measure_openings')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('report_id', report.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('job_measure_photos')
        .select('*')
        .eq('org_id', context.orgId)
        .eq('report_id', report.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false }),
    ])

  if (elevationsError) throw elevationsError
  if (openingsError) throw openingsError
  if (photosError) throw photosError

  const openingsByElevation = new Map<string, any[]>()
  for (const opening of openings || []) {
    const list = openingsByElevation.get(opening.elevation_id) || []
    list.push(opening)
    openingsByElevation.set(opening.elevation_id, list)
  }

  const photosWithUrls = await Promise.all(
    (photos || []).map(async (photo) => {
      const { data: signed } = await supabase.storage
        .from(FILES_BUCKET)
        .createSignedUrl(photo.storage_path, 60 * 60 * 24 * 7)
      return {
        ...photo,
        url: signed?.signedUrl ?? null,
      }
    })
  )

  return {
    report,
    elevations: (elevations || []).map((elevation) => ({
      ...elevation,
      openings: openingsByElevation.get(elevation.id) || [],
    })),
    photos: photosWithUrls,
  }
}

export async function saveExteriorMeasure(args: {
  supabase: ReturnType<typeof createServiceClient>
  context: MeasureContext
  authUserId: string
  body: any
}) {
  const { supabase, context, authUserId, body } = args
  const incomingReport = body?.report || {}
  const incomingElevations = Array.isArray(body?.elevations) ? body.elevations : []

  const { data: existingReport, error: existingError } = await supabase
    .from('job_measure_reports')
    .select('id')
    .eq('org_id', context.orgId)
    .eq('opportunity_id', context.opportunityId)
    .maybeSingle()

  if (existingError) throw existingError

  const reportPayload = {
    org_id: context.orgId,
    opportunity_id: context.opportunityId,
    job_id: context.jobId,
    measure_kind: ['roof', 'siding', 'windows', 'gutters_soffit_fascia', 'full_exterior'].includes(incomingReport.measure_kind)
      ? incomingReport.measure_kind
      : 'siding',
    status: ['draft', 'reviewed', 'final'].includes(incomingReport.status) ? incomingReport.status : 'draft',
    report_title: String(incomingReport.report_title || 'ARX Exterior Measure Report').slice(0, 160),
    waste_percent: numberOrZero(incomingReport.waste_percent ?? 10),
    notes: typeof incomingReport.notes === 'string' ? incomingReport.notes : null,
    updated_by: authUserId,
    ...(existingReport ? {} : { created_by: authUserId }),
  }

  const reportMutation = existingReport
    ? supabase
        .from('job_measure_reports')
        .update(reportPayload)
        .eq('id', existingReport.id)
        .eq('org_id', context.orgId)
        .select('*')
        .single()
    : supabase.from('job_measure_reports').insert(reportPayload).select('*').single()

  const { data: report, error: reportError } = await reportMutation
  if (reportError) throw reportError

  const [{ data: existingElevations }, { data: existingOpenings }] = await Promise.all([
    supabase
      .from('job_measure_elevations')
      .select('id')
      .eq('org_id', context.orgId)
      .eq('report_id', report.id),
    supabase
      .from('job_measure_openings')
      .select('id')
      .eq('org_id', context.orgId)
      .eq('report_id', report.id),
  ])
  const existingElevationIds = new Set((existingElevations || []).map((row) => row.id))
  const existingOpeningIds = new Set((existingOpenings || []).map((row) => row.id))

  const keptElevationIds: string[] = []
  for (let index = 0; index < incomingElevations.length; index += 1) {
    const elevation = incomingElevations[index] || {}
    const elevationId =
      typeof elevation.id === 'string' && existingElevationIds.has(elevation.id) ? elevation.id : crypto.randomUUID()
    const elevationPayload = {
      id: elevationId,
      org_id: context.orgId,
      report_id: report.id,
      opportunity_id: context.opportunityId,
      job_id: context.jobId,
      elevation_name: String(elevation.elevation_name || `Elevation ${index + 1}`).slice(0, 80),
      sort_order: index,
      wall_width_ft: numberOrZero(elevation.wall_width_ft),
      wall_height_ft: numberOrZero(elevation.wall_height_ft),
      gable_width_ft: numberOrZero(elevation.gable_width_ft),
      gable_height_ft: numberOrZero(elevation.gable_height_ft),
      waste_percent:
        elevation.waste_percent === null || elevation.waste_percent === ''
          ? null
          : numberOrZero(elevation.waste_percent ?? report.waste_percent),
      soffit_depth_ft: numberOrZero(elevation.soffit_depth_ft),
      soffit_length_ft: numberOrZero(elevation.soffit_length_ft),
      fascia_lf: numberOrZero(elevation.fascia_lf),
      gutter_lf: numberOrZero(elevation.gutter_lf),
      starter_strip_lf: numberOrZero(elevation.starter_strip_lf),
      j_channel_lf: numberOrZero(elevation.j_channel_lf),
      inside_corners: intOrZero(elevation.inside_corners),
      outside_corners: intOrZero(elevation.outside_corners),
      notes: typeof elevation.notes === 'string' ? elevation.notes : null,
    }

    const { data: savedElevation, error: elevationError } = await supabase
      .from('job_measure_elevations')
      .upsert(elevationPayload, { onConflict: 'id' })
      .select('id')
      .single()

    if (elevationError) throw elevationError
    keptElevationIds.push(savedElevation.id)

    const incomingOpenings = Array.isArray(elevation.openings) ? elevation.openings : []
    const keptOpeningIds: string[] = []
    for (const opening of incomingOpenings) {
      const openingId =
        typeof opening?.id === 'string' && existingOpeningIds.has(opening.id) ? opening.id : crypto.randomUUID()
      const openingPayload = {
        id: openingId,
        org_id: context.orgId,
        report_id: report.id,
        elevation_id: savedElevation.id,
        opportunity_id: context.opportunityId,
        job_id: context.jobId,
        opening_type: ['window', 'door', 'garage_door', 'other'].includes(opening?.opening_type)
          ? opening.opening_type
          : 'window',
        label: typeof opening?.label === 'string' ? opening.label.slice(0, 80) : null,
        quantity: Math.max(1, intOrZero(opening?.quantity || 1)),
        width_ft: numberOrZero(opening?.width_ft),
        height_ft: numberOrZero(opening?.height_ft),
        notes: typeof opening?.notes === 'string' ? opening.notes : null,
      }
      const { data: savedOpening, error: openingError } = await supabase
        .from('job_measure_openings')
        .upsert(openingPayload, { onConflict: 'id' })
        .select('id')
        .single()

      if (openingError) throw openingError
      keptOpeningIds.push(savedOpening.id)
    }

    let deleteOpenings = supabase
      .from('job_measure_openings')
      .delete()
      .eq('org_id', context.orgId)
      .eq('elevation_id', savedElevation.id)
    if (keptOpeningIds.length > 0) deleteOpenings = deleteOpenings.not('id', 'in', `(${keptOpeningIds.join(',')})`)
    const { error: deleteOpeningsError } = await deleteOpenings
    if (deleteOpeningsError) throw deleteOpeningsError
  }

  let deleteElevations = supabase
    .from('job_measure_elevations')
    .delete()
    .eq('org_id', context.orgId)
    .eq('report_id', report.id)
  if (keptElevationIds.length > 0) deleteElevations = deleteElevations.not('id', 'in', `(${keptElevationIds.join(',')})`)
  const { error: deleteElevationsError } = await deleteElevations
  if (deleteElevationsError) throw deleteElevationsError

  return loadExteriorMeasure(supabase, context)
}

export async function uploadExteriorMeasurePhoto(args: {
  supabase: ReturnType<typeof createServiceClient>
  context: MeasureContext
  userId: string
  file: File
  elevationId?: string | null
  openingId?: string | null
  caption?: string | null
}) {
  const { supabase, context, userId, file } = args

  const { data: report, error: reportError } = await supabase
    .from('job_measure_reports')
    .select('id')
    .eq('org_id', context.orgId)
    .eq('opportunity_id', context.opportunityId)
    .maybeSingle()

  if (reportError) throw reportError
  if (!report) throw new Error('Save the measure report before adding photos.')

  let elevationId: string | null = null
  if (args.elevationId) {
    const { data: elevation } = await supabase
      .from('job_measure_elevations')
      .select('id')
      .eq('id', args.elevationId)
      .eq('org_id', context.orgId)
      .eq('report_id', report.id)
      .maybeSingle()
    if (!elevation) throw new Error('Elevation not found')
    elevationId = elevation.id
  }

  let openingId: string | null = null
  if (args.openingId) {
    const { data: opening } = await supabase
      .from('job_measure_openings')
      .select('id, elevation_id')
      .eq('id', args.openingId)
      .eq('org_id', context.orgId)
      .eq('report_id', report.id)
      .maybeSingle()
    if (!opening) throw new Error('Opening not found')
    openingId = opening.id
    elevationId = elevationId || opening.elevation_id
  }

  const photoId = crypto.randomUUID()
  const safeName = safeUploadFilename(file.name, 'measure-photo')
  const storagePath = `${context.orgId}/opportunities/${context.opportunityId}/measure/${photoId}_${safeName}`
  const fileBuffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage.from(FILES_BUCKET).upload(storagePath, fileBuffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data: photo, error: insertError } = await supabase
    .from('job_measure_photos')
    .insert({
      id: photoId,
      org_id: context.orgId,
      report_id: report.id,
      elevation_id: elevationId,
      opening_id: openingId,
      opportunity_id: context.opportunityId,
      job_id: context.jobId,
      storage_path: storagePath,
      filename: safeName,
      file_size: file.size,
      mime_type: file.type || null,
      caption: args.caption || null,
      created_by: userId,
    })
    .select('*')
    .single()

  if (insertError) {
    await supabase.storage.from(FILES_BUCKET).remove([storagePath])
    throw insertError
  }

  const { data: signed } = await supabase.storage
    .from(FILES_BUCKET)
    .createSignedUrl(photo.storage_path, 60 * 60 * 24 * 7)

  return { ...photo, url: signed?.signedUrl ?? null }
}
