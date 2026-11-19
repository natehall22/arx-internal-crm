import { cookies } from 'next/headers'
import { cache } from 'react'

import { getRequestHostFence } from '@/lib/company-host-server'
import { readOrgFeatureSettings } from '@/lib/org-features'
import { clientOrgProfile, resolveOrgProfile } from '@/lib/org-profile'
import { getSupabaseSessionFromCookieStore } from '@/lib/supabase/session-cookie'
import { createServiceClient } from '@/lib/supabase/service'
import type { OrgBootstrap } from '@/lib/org-bootstrap'

/**
 * The company's words and feature switches for the FIRST paint, resolved from the address (company subdomain or
 * DEPLOYMENT_ORG_ID) — so a lawn company never sees roofing words while the client fetch is in flight. Same rule as
 * /api/me/effective-permissions (resolveOrgProfile with the plan). Open/legacy address, closed fence or a failed read →
 * null: the hooks keep their old first-render rule and settle on the fetch, exactly as before.
 */
export const loadRequestOrgBootstrap = cache(async (): Promise<OrgBootstrap | null> => {
  try {
    const fence = await getRequestHostFence()
    if (fence.kind !== 'org') return null
    const s = await readOrgFeatureSettings(createServiceClient(), fence.orgId)
    const p = resolveOrgProfile(s, s.entitlements)
    let signedIn = false
    try {
      signedIn = Boolean(getSupabaseSessionFromCookieStore(cookies())?.access_token)
    } catch {
      signedIn = false
    }
    return { profile: clientOrgProfile(p), features: signedIn ? p.features : null }
  } catch (e) {
    console.error('[org-bootstrap] first-paint profile not readable; client fetch decides', e)
    return null
  }
})
