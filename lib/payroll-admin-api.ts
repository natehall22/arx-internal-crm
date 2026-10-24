import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isPayrollAdminRole } from '@/lib/payroll-admin-access'
import { isPayWeekEnabled } from '@/lib/payroll-flag'
import { createServiceClient } from '@/lib/supabase/service'

/** Payroll-admin gate for the "Pay this week" API routes: 401 / 403 as a ready NextResponse, else the profile + service client. */
export async function requirePayrollAdminApi() {
  // The new payroll screens ship OFF (PAYROLL_PAY_WEEK_ENABLED): the routes do not exist until the flag is turned on.
  if (!isPayWeekEnabled()) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  try {
    const { profile } = await requireAuthApi()
    if (!isPayrollAdminRole(profile.role)) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const
    return { profile, admin: createServiceClient() } as const
  } catch {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  }
}
