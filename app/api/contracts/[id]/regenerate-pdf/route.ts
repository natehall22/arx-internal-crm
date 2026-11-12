import { NextRequest, NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { ensureContractPdf } from '@/lib/contracts/finalize-pdf'
import { completeEnvelope } from '@/lib/signing/complete'
import { filesObjectHref } from '@/lib/files/files-object'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/contracts/[id]/regenerate-pdf — finish a SIGNED contract whose PDF was never stored ("PDF pending").
 * Makes the PDF from the signature the customer already gave; never touches a PDF that exists and never changes
 * the contract's status. Same people as the contract screens (field roles barred), same company only.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { authUser, profile } = auth
  try {
    const service = createServiceClient()
    if (await resolveSalesDocAccessBarred(service, authUser.id, profile)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: contract } = await service
      .from('order_form_contracts')
      .select('id, status, quote_approval_id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract not found' }, { status: 404 })
    if (contract.status !== 'completed') {
      return NextResponse.json({ error: 'The contract must be signed before a PDF can be generated.' }, { status: 400 })
    }

    const result = await ensureContractPdf(service, contract.id, profile.org_id)
    if (!result.path) {
      return NextResponse.json({ error: result.error || 'Failed to generate PDF' }, { status: 500 })
    }
    // A signed agreement whose PDF came late now gets its hash and certificate (never blocks the PDF; quote approvals have none).
    if (contract.status === 'completed' && !contract.quote_approval_id) {
      await completeEnvelope(service, { kind: 'contract', docId: contract.id, orgId: profile.org_id }).catch((e) => console.error('[Contract Regenerate PDF] signing engine completion failed:', e))
    }
    return NextResponse.json({ success: true, pdfUrl: filesObjectHref(result.path) })
  } catch (e) {
    console.error('[Contract Regenerate PDF]', e)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}
