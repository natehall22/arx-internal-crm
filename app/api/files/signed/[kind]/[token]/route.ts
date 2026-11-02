import { NextResponse } from 'next/server'

import {
  filesPathFromStoredUrl,
  isPlausibleSigningToken,
  isSignedDocKind,
  signFilesObject,
} from '@/lib/files/files-object'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/files/signed/<contract|change-order>/<signing token>
 * Customer download of a SIGNED contract / change order, no login: the signing token is the credential (same one the signing
 * page uses). Only signed documents (completed, or voided after the customer signed) with a stored PDF; the 7-day signing expiry does not apply to downloading a signed copy.
 * Success is a 302 to a short-lived signed URL. Anything else is a 404.
 */
const PRIVATE = { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' }
const CUSTOMER_SIGNED_URL_TTL_SECONDS = 60 * 10

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PRIVATE })
}

export async function GET(_request: Request, { params }: { params: { kind: string; token: string } }) {
  const kind = params.kind
  const token = String(params.token ?? '')
  if (!isSignedDocKind(kind) || !isPlausibleSigningToken(kind, token)) return notFound()

  try {
    const admin = createServiceClient()
    const table = kind === 'contract' ? 'order_form_contracts' : 'job_change_orders'
    const { data: doc } = await admin
      .from(table)
      .select('status, customer_signed_at, pdf_url, pdf_storage_path')
      .eq('signing_token', token)
      .maybeSingle()

    // Signed = completed, or a contract superseded by a later signature (voided, never deleted, executed copy kept) — the
    // customer's emailed link to what they signed keeps working.
    const isSigned = doc?.status === 'completed' || (doc?.status === 'voided' && !!doc?.customer_signed_at)
    if (!doc || !isSigned) return notFound()

    const storedUrl = String(doc.pdf_url ?? '').trim()
    // The old contract-signing fallback uploaded to the `contracts` bucket when `files` failed; that URL is not a `files`
    // object, so keep sending the customer where they went before.
    // Only ever redirect to our own Supabase storage origin, never to an arbitrary stored URL.
    if (storedUrl && /^https?:\/\//i.test(storedUrl) && !filesPathFromStoredUrl(storedUrl)) {
      const supabaseOrigin = (() => {
        try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin } catch { return null }
      })()
      let storedOrigin: string | null = null
      try { storedOrigin = new URL(storedUrl).origin } catch { storedOrigin = null }
      if (!supabaseOrigin || storedOrigin !== supabaseOrigin) return notFound()
      return NextResponse.redirect(storedUrl, { status: 302, headers: PRIVATE })
    }

    const path = filesPathFromStoredUrl(doc.pdf_storage_path) ?? filesPathFromStoredUrl(storedUrl)
    if (!path) return notFound()

    const signedUrl = await signFilesObject(admin, path, CUSTOMER_SIGNED_URL_TTL_SECONDS)
    if (!signedUrl) return notFound()
    return NextResponse.redirect(signedUrl, { status: 302, headers: PRIVATE })
  } catch (error) {
    console.error('[files/signed] error:', error)
    return NextResponse.json({ error: 'Could not open document' }, { status: 500, headers: PRIVATE })
  }
}
