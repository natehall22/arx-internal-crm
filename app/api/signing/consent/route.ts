import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { getDocumentBrand } from '@/lib/org-brand'
import { esignDisclosure } from '@/lib/signing/consent'
import { loadSigningSettings } from '@/lib/signing/settings-server'
import { resolveSalesDocAccessBarred } from '@/lib/sales-doc-access'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/signing/consent — the e-sign notice the rep's device must show when the customer signs in person, or
 * { required: false }. Own company only; field roles refused (they never take a signature on a money document).
 */
export async function GET() {
  let auth: Awaited<ReturnType<typeof requireAuthApi>>
  try {
    auth = await requireAuthApi()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createServiceClient()
  if (await resolveSalesDocAccessBarred(admin, auth.authUser.id, auth.profile)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const settings = await loadSigningSettings(admin, auth.profile.org_id)
  if (!settings.consentStep) return NextResponse.json({ required: false }, { headers: { 'Cache-Control': 'private, no-store' } })
  const brand = await getDocumentBrand(admin, auth.profile.org_id)
  return NextResponse.json({ required: true, disclosure: esignDisclosure({ name: brand.name, phone: brand.phone, email: brand.email }) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
