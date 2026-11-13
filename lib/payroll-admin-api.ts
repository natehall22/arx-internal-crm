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

/**
 * The OLD period API (create week, edit cutoff / pay date, mark paid, reopen, old hours writer, lock) is closed once the pay-week path
 * is on: weeks are found/made only by `findWeekNear` / `findOrCreateWeek`, approved only by Pay this week. A stale tab or script that
 * moved a week's cutoff would make the Pay screen create a second week for the same days. Null = flag off, the old route runs as before.
 * Delete with the legacy pages (Known Redundancy #15, two payroll lock paths).
 */
export function oldPayrollWriteGone(message = 'Payroll moved to Pay this week.'): NextResponse | null {
  if (!isPayWeekEnabled()) return null
  return NextResponse.json({ error: message, code: 'use_pay_this_week' }, { status: 410 })
}
