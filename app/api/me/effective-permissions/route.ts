import { NextResponse } from 'next/server'

import { resolveEffectivePermissionNames } from '@/lib/effective-permissions'
import { requireAuthApi } from '@/lib/auth'
import { brandDocument, getOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'
import { clientBrandNames } from '@/lib/org-brand-client'
import { clientOrgProfile, loadOrgProfile } from '@/lib/org-profile'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { createServiceClient } from '@/lib/supabase/service'
import { orgLogoHref } from '@/lib/files/files-object'

export const dynamic = 'force-dynamic'

/** The caller's own company's chrome branding: name + logo hrefs (public logo route, dark variant for the dark nav). Not money, so every role gets it. */
async function loadNavBranding(admin: ReturnType<typeof createServiceClient>, orgId: string, name: string) {
  let logoHref: string | null = null
  let logoDarkHref: string | null = null
  try {
    const { data, error } = await admin
      .from('orgs')
      .select('logo_url, settings_logo:settings->logo_url, settings_logo_dark:settings->logo_dark_url')
      .eq('id', orgId)
      .maybeSingle()
    if (error) throw error
    const row = data as { logo_url?: string | null; settings_logo?: unknown; settings_logo_dark?: unknown } | null
    const org = { logo_url: row?.logo_url ?? null, settings: { logo_url: row?.settings_logo, logo_dark_url: row?.settings_logo_dark } }
    logoHref = orgLogoHref(orgId, org)
    logoDarkHref = orgLogoHref(orgId, org, { variant: 'dark' })
  } catch (e) {
    console.error('GET /api/me/effective-permissions: org logo not readable', orgId, e)
  }
  return { name, logoHref, logoDarkHref }
}

export async function GET() {
  try {
    const { authUser, profile } = await requireAuthApi()
    const admin = createServiceClient()

    const [{ fullAccess, permissionNames }, orgProfile, orgBrand] = await Promise.all([
      resolveEffectivePermissionNames(admin, authUser.id, {
        role: profile.role as string,
        custom_role_id: profile.custom_role_id,
      }),
      loadOrgProfile(admin, profile.org_id),
      getOrgBrand(admin, profile.org_id),
    ])

    const documentBrand = brandDocument(orgBrand)
    const org = await loadNavBranding(admin, profile.org_id as string, documentBrand.name)

    return NextResponse.json({
      role: profile.role,
      fullAccess,
      permissions: Array.from(permissionNames).sort(),
      // Server-side feature flags the client needs (the new payroll screens ship OFF; company feature switches,
      // lib/org-features.ts — and the industry profile's words/menu/price book lists, lib/org-profile.ts — read
      // client-side through hooks/useOrgFeatures.ts). `features` is the profile-aware map (one rule, resolveOrgFeatures).
      org,
      flags: { payWeek: isPayWeekEnabled(), features: orgProfile.features, profile: clientOrgProfile(orgProfile), brand: { ...clientBrandNames(documentBrand), original: usesOriginalCompanyAssets(orgBrand) } },
    })
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Account disabled')) {
      return NextResponse.json({ error: e.message }, { status: 401 })
    }
    console.error('GET /api/me/effective-permissions', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
