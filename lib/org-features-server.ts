/**
 * Server-side gates for per-company feature switches. Reads ONLY through `loadOrgFeatures` (lib/org-features.ts).
 * - Pages / layouts: `requireOrgFeaturePage(orgId, feature)` → notFound() when the feature is off.
 * - API routes: `orgFeatureOffResponse(orgId, feature)` → a 403 NextResponse when off, else null.
 */
import * as React from 'react'
import { notFound } from 'next/navigation'
import { NextResponse } from 'next/server'

import { ALL_FEATURES_ON, loadOrgFeatures, ORG_FEATURE_DEFS, type OrgFeature, type OrgFeatures } from '@/lib/org-features'
import { createServiceClient } from '@/lib/supabase/service'

/** React's per-request memo where it exists (the Next server runtime); a plain call elsewhere (jest). */
const perRequest: <F extends (...args: never[]) => unknown>(fn: F) => F =
  typeof (React as { cache?: unknown }).cache === 'function' ? (React as unknown as { cache: <F>(fn: F) => F }).cache : (fn) => fn

/** One read per org per server render (layout + page share it). */
export const getOrgFeatures = perRequest(async (orgId: string | null | undefined): Promise<OrgFeatures> => {
  let client: ReturnType<typeof createServiceClient>
  try {
    client = createServiceClient()
  } catch (e) {
    console.error('getOrgFeatures: no database client, using all on', e)
    return { ...ALL_FEATURES_ON }
  }
  return loadOrgFeatures(client, orgId)
})

export async function isOrgFeatureOn(orgId: string | null | undefined, feature: OrgFeature): Promise<boolean> {
  return (await getOrgFeatures(orgId))[feature]
}

/** Server pages: 404 when the company has this feature turned off. */
export async function requireOrgFeaturePage(orgId: string | null | undefined, feature: OrgFeature): Promise<void> {
  if (!(await isOrgFeatureOn(orgId, feature))) notFound()
}

/** API routes: a 403 response when the company has this feature turned off, else null. */
export async function orgFeatureOffResponse(orgId: string | null | undefined, feature: OrgFeature): Promise<NextResponse | null> {
  if (await isOrgFeatureOn(orgId, feature)) return null
  return NextResponse.json({ error: `${ORG_FEATURE_DEFS[feature].label} is turned off for this company`, code: 'feature_off' }, { status: 403 })
}
