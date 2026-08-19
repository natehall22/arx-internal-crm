/**
 * Renders the one-page job run sheet PDF on demand.
 *
 * Never cached and never written to storage: the sheet is only useful if it reflects the job as
 * it stands right now, including any ops edits saved a minute ago.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { buildJobRunSheet } from '@/lib/job-run-sheet'
import { resolveOpsAccess } from '@/lib/ops-access'
import { generateJobRunSheetPDF } from '@/lib/pdf/job-run-sheet'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  let profile
  let admin
  try {
    const auth = await requireAuthApi()
    profile = auth.profile
    admin = createServiceClient()
    const access = await resolveOpsAccess(admin, auth.authUser.id, profile)
    if (!access.canJobBoard) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const sheet = await buildJobRunSheet(admin, profile.org_id, params.id)
    if (!sheet) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const pdf = generateJobRunSheetPDF(sheet)
    const safeJobNumber = sheet.jobNumber.replace(/[^A-Za-z0-9._-]/g, '-')
    // `download=1` makes the browser save it (for emailing); default opens inline for printing.
    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

    // Node Buffer is not a valid BodyInit for the web Response type; hand over the bytes.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${disposition}; filename="Run Sheet ${safeJobNumber}.pdf"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('[Run sheet PDF] generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate run sheet' }, { status: 500 })
  }
}
