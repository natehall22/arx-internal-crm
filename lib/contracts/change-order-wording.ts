import type { SupabaseClient } from '@supabase/supabase-js'

import { loadOrgProfile } from '@/lib/org-profile'

/** What a change order says it modifies. The roofing profile keeps its own word (the PDF is unchanged for it). */
export const ROOFING_CHANGE_ORDER_DOCUMENT = 'Installation Agreement'
export const OTHER_CHANGE_ORDER_DOCUMENT = 'approved quote or agreement'

/** Server: the document name for this company's change orders (roofing → "Installation Agreement"; others → the quote / agreement the customer approved). */
export async function changeOrderDocumentName(client: SupabaseClient, orgId: string | null | undefined): Promise<string> {
  const profile = await loadOrgProfile(client, orgId)
  return profile.id === 'roofing' ? ROOFING_CHANGE_ORDER_DOCUMENT : OTHER_CHANGE_ORDER_DOCUMENT
}
