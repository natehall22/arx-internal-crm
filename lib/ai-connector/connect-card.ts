import { isOrgFeatureOn } from '@/lib/org-features-server'
import { getOrgBrand } from '@/lib/org-brand'
import { createServiceClient } from '@/lib/supabase/service'

import { AI_CONNECTOR_FEATURE } from './config'
import { mcpResource, requestOrigin } from './urls'

export type ConnectCardInfo = { address: string; companyName: string }

/**
 * What the "Connect your AI" card needs: the company's own connector address (the same `/mcp` resource the OAuth
 * metadata advertises) and the company's name. null when the company has the AI connector off, so no card is shown.
 */
export async function loadConnectCard(request: Request, orgId: string | null | undefined): Promise<ConnectCardInfo | null> {
  if (!orgId || !(await isOrgFeatureOn(orgId, AI_CONNECTOR_FEATURE))) return null
  const brand = await getOrgBrand(createServiceClient(), orgId)
  return { address: mcpResource(requestOrigin(request)), companyName: brand.name }
}
