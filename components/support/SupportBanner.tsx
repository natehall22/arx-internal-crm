import { cookies } from 'next/headers'

import { createServiceClient } from '@/lib/supabase/service'
import { checkSupportSession } from '@/lib/support/access'
import { supportCookieFrom, verifySupportToken } from '@/lib/support/token'

import SupportBannerView from './SupportBannerView'

/**
 * Root-layout banner (Nav is per page, so this is the one place every page — signed in or not — gets it). No cookie = renders
 * nothing and reads nothing. With one, it re-checks the session for real: a session that has ended shows no banner (and no access).
 */
export default async function SupportBanner() {
  let value: string | null = null
  try {
    value = supportCookieFrom(cookies())
  } catch {
    return null
  }
  const payload = await verifySupportToken(value, 'session')
  if (!payload) return null
  const admin = createServiceClient()
  const checked = await checkSupportSession(admin, payload)
  if (checked.status !== 'ok') return null
  const { data: org } = await admin.from('orgs').select('name').eq('id', payload.o).maybeSingle()
  const company = (org as { name?: string | null } | null)?.name || 'this company'
  const user = checked.profile.full_name || checked.profile.email || 'a user'
  return <SupportBannerView company={company} user={user} level={payload.l} />
}
