import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireAuthApi } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveOpsAccess } from '@/lib/ops-access'
import { FILES_BUCKET } from '@/lib/files/storage'
import { stitchElevationPhotos, type ImageBuffer } from '@/lib/stitch-elevation-photos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on this server.')
  return new OpenAI({ apiKey })
}

function buildPrompt(scaleReferenceLabel?: string, scaleReferenceFt?: number): string {
  const scaleSection = scaleReferenceLabel && scaleReferenceFt
    ? `\nSCALE REFERENCE (use this to calibrate ALL other measurements):
The "${scaleReferenceLabel}" visible in this image measures exactly ${scaleReferenceFt} ft.
Use that known dimension as your ruler — derive every other measurement proportionally from pixel relationships to this reference.\n`
    : `\nNo scale reference provided. Use standard residential construction dimensions as your best estimate.\n`

  return `You are an expert exterior contractor estimating a residential home for siding, windows, and trim.

The image below is a stitched panorama of one elevation (one side of the building) assembled from multiple on-site photos.
${scaleSection}
Standard residential construction knowledge:
- Single-story wall height: 8–10 ft. Two-story: 17–20 ft.
- Standard double-hung window: ~2.5–3 ft wide × 3.5–4.5 ft tall
- Standard entry door: 3 ft wide × 6.8 ft tall
- Single garage door: ~9 ft wide × 7 ft tall. Double: ~16 ft wide × 7 ft tall
- Soffit depth (eave overhang): typically 1–2 ft
- Soffit length, fascia lf, gutter lf, and starter strip lf all equal the full horizontal eave run
- J-channel runs around every window and door perimeter — sum all opening perimeters
- Count inside corners (walls meeting inward) and outside corners (walls meeting outward) on this elevation

Openings: group identical windows (same type + same size) into one entry with quantity > 1.

Return ONLY valid JSON — no markdown fences, no extra text:
{
  "wall_width_ft": number,
  "wall_height_ft": number,
  "gable_width_ft": number,
  "gable_height_ft": number,
  "soffit_depth_ft": number,
  "soffit_length_ft": number,
  "fascia_lf": number,
  "gutter_lf": number,
  "starter_strip_lf": number,
  "j_channel_lf": number,
  "inside_corners": number,
  "outside_corners": number,
  "openings": [
    {
      "opening_type": "window" | "door" | "garage_door" | "other",
      "quantity": number,
      "width_ft": number,
      "height_ft": number,
      "label": string
    }
  ],
  "confidence": number,
  "notes": string
}`
}

export async function POST(request: NextRequest) {
  try {
    const { authUser, profile } = await requireAuthApi()
    const supabase = createServiceClient()
    const { canJobBoard } = await resolveOpsAccess(supabase, authUser.id, profile)
    if (!canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const {
      reportId,
      elevationId,
      scaleReferenceLabel,
      scaleReferenceFt,
    }: {
      reportId?: string
      elevationId?: string
      scaleReferenceLabel?: string
      scaleReferenceFt?: number
    } = body || {}

    if (!reportId || !elevationId) {
      return NextResponse.json({ error: 'reportId and elevationId are required' }, { status: 400 })
    }

    // Verify the report belongs to this org
    const { data: report } = await supabase
      .from('job_measure_reports')
      .select('id, org_id')
      .eq('id', reportId)
      .eq('org_id', profile.org_id)
      .single()

    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    // Fetch up to 6 photos — stitching handles the token budget via downscaling
    const { data: photos } = await supabase
      .from('job_measure_photos')
      .select('id, storage_path, mime_type, filename')
      .eq('org_id', profile.org_id)
      .eq('report_id', reportId)
      .eq('elevation_id', elevationId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(6)

    if (!photos || photos.length === 0) {
      return NextResponse.json(
        { error: 'No photos found for this elevation. Upload photos first, then scan.' },
        { status: 400 }
      )
    }

    // Download all photos in parallel
    const imageBuffers = await Promise.all(
      photos.map(async (photo): Promise<ImageBuffer | null> => {
        const { data, error } = await supabase.storage.from(FILES_BUCKET).download(photo.storage_path)
        if (error || !data) return null
        const buffer = Buffer.from(await data.arrayBuffer())
        const mimeType =
          photo.mime_type ||
          (photo.filename?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
        return { buffer, mimeType }
      })
    )

    const validBuffers = imageBuffers.filter(Boolean) as ImageBuffer[]

    if (validBuffers.length === 0) {
      return NextResponse.json({ error: 'Could not load photos from storage' }, { status: 500 })
    }

    // Stitch into a single panorama — gives AI continuous context across the full elevation
    const stitchedBase64 = await stitchElevationPhotos(validBuffers)

    const prompt = buildPrompt(scaleReferenceLabel, scaleReferenceFt)
    const openai = getOpenAI()

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${stitchedBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    })

    const responseText = completion.choices[0]?.message?.content || ''

    let estimates: Record<string, unknown>
    try {
      estimates = JSON.parse(responseText)
    } catch {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        estimates = JSON.parse(jsonMatch[0])
      } else {
        console.error('AI exterior scan: unparseable response:', responseText)
        return NextResponse.json({ error: 'AI returned an unreadable response. Try again.' }, { status: 500 })
      }
    }

    return NextResponse.json({
      estimates,
      photoCount: validBuffers.length,
      stitched: validBuffers.length > 1,
      scaleApplied: Boolean(scaleReferenceLabel && scaleReferenceFt),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI scan failed'
    console.error('AI exterior scan error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
