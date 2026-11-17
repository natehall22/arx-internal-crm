import { getOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { loadOrgProfile } from '@/lib/org-profile'
import { orgLogoHref } from '@/lib/files/files-object'
import { printKitBrand } from '@/lib/print-kit'
import AppointmentCardsClient from './AppointmentCardsClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

const ADMIN_TOOL_ROLES = [
  'admin',
  'owner',
  'regional_manager',
  'regional_setter_manager',
  'sales_manager',
  'setter_manager',
  'manager',
  'operations',
]

export default async function AppointmentCardsPage() {
  const { profile } = await requireAuth()
  if (!ADMIN_TOOL_ROLES.includes(profile.role)) redirect('/dashboard')
  const admin = createServiceClient()
  const orgProfile = await loadOrgProfile(admin, profile.org_id)
  // The company's own name and logo (orgs row); roofing keeps the card exactly as it was (lib/print-kit.ts).
  const { data: org } = await admin.from('orgs').select('name, email, logo_url, settings').eq('id', profile.org_id).maybeSingle()
  const brand = printKitBrand(orgProfile, { name: org?.name ?? '', logoHref: orgLogoHref(profile.org_id, org), original: usesOriginalCompanyAssets(await getOrgBrand(admin, profile.org_id)) })

  return <AppointmentCardsClient brand={brand} />
}
