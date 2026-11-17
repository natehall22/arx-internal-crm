import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { loadOrgProfile } from '@/lib/org-profile'
import { getOrgBrand, usesOriginalCompanyAssets } from '@/lib/org-brand'
import { doorDropAvailable } from '@/lib/print-kit'
import DoorDropClient from './DoorDropClient'

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

export default async function DoorDropPage() {
  const { profile } = await requireAuth()
  if (!ADMIN_TOOL_ROLES.includes(profile.role)) redirect('/dashboard')
  // The letter is roofing copy (roof evaluation, storm, insurance): other companies never get it.
  // It is also the original company's own artwork, name, site and phone: another roofing company never gets that letter.
  const admin = createServiceClient()
  if (!doorDropAvailable(await loadOrgProfile(admin, profile.org_id)) || !usesOriginalCompanyAssets(await getOrgBrand(admin, profile.org_id))) notFound()

  return <DoorDropClient />
}
