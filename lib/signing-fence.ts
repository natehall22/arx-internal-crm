/**
 * Signing links are company-scoped like /pay links: a token opened on ANOTHER company's address is "not found" (so company
 * A's link never renders on company B's host with A's branding, and a signature can't be posted through it). Same rule
 * and helper as the pay page (lib/company-host.ts `fenceAllowsOrg`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { fenceAllowsOrg } from '@/lib/company-host'
import { getRequestHostFence } from '@/lib/company-host-server'
import { findBySigningToken, type SigningDocKind } from '@/lib/signing-tokens'

/** The document a token belongs to, or null — bad token, unknown, or opened on the wrong company's address. */
export async function findBySigningTokenOnThisHost(
  admin: SupabaseClient,
  kind: SigningDocKind,
  token: unknown,
  columns = '*'
): Promise<Record<string, any> | null> {
  const doc = await findBySigningToken(admin, kind, token, columns)
  if (!doc) return null
  const fence = await getRequestHostFence()
  return fenceAllowsOrg(fence, doc.org_id as string | null | undefined) ? doc : null
}
