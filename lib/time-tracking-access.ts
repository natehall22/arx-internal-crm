import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { orgFeatureOffResponse } from '@/lib/org-features-server'
import { isSuperAdmin } from '@/lib/super-admin'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Who works the office time list: payroll admins (PAYROLL_ADMIN_ROLES) — time is pay. Settings: owners only.
 * Returns a ready 401 / 403 / feature-off response, or the profile + service client.
 */
export async function requireTimeOfficeApi(opts: { owner?: boolean } = {}) {
  let profile: { id: string; org_id: string; role: string; is_super_admin?: boolean | null }
  try {
    ;({ profile } = (await requireAuthApi()) as unknown as { profile: typeof profile })
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
  const off = await orgFeatureOffResponse(profile.org_id, 'timeTracking')
  if (off) return { error: off } as const
  const allowed = opts.owner ? isSuperAdmin(profile as never) : isPayrollAdminRole(profile.role)
  if (!allowed) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
  return { profile, admin: createServiceClient() } as const
}
