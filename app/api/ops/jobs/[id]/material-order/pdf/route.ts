/**
 * Renders the one-page materials order sheet PDF on demand.
 *
 * Same contract as the run sheet PDF route: never cached, never written to storage, because the
 * sheet is only useful if it reflects the quantities as they stand right now.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { buildJobMaterialOrder } from '@/lib/job-material-order'
import { resolveOpsAccess } from '@/lib/ops-access'
import { generateJobMaterialOrderPDF } from '@/lib/pdf/job-material-order'
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
    const order = await buildJobMaterialOrder(admin, profile.org_id, params.id)
    if (!order) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const pdf = generateJobMaterialOrderPDF(order)
    const safeJobNumber = order.jobNumber.replace(/[^A-Za-z0-9._-]/g, '-')
    // `download=1` makes the browser save it (for emailing a supplier); default opens inline.
    const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

    // Node Buffer is not a valid BodyInit for the web Response type; hand over the bytes.
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${disposition}; filename="Order Sheet ${safeJobNumber}.pdf"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('[Material order PDF] generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate order sheet' }, { status: 500 })
  }
}
