import { NextResponse } from 'next/server'

import { mergeOrgSettings } from '@/lib/org-settings'
import { TIME_TRACKING_SETTINGS_KEY, parseTimeTrackingSettingsPatch } from '@/lib/time-tracking'
import { requireTimeOfficeApi } from '@/lib/time-tracking-access'
import { loadClockConfig, loadSelfClockRoleChoices } from '@/lib/time-tracking-db'

export const dynamic = 'force-dynamic'

/** GET — the company's time clock settings (owners). */
export async function GET() {
  const a = await requireTimeOfficeApi({ owner: true })
  if (a.error) return a.error
  return NextResponse.json({ settings: (await loadClockConfig(a.admin, a.profile.org_id)).settings, roles: await loadSelfClockRoleChoices(a.admin, a.profile.org_id) })
}

/** PATCH { timeTracking: { autoCloseHours?, captureLocation?, overtimeAfterHours?, breakWarningAfterHours? } } — owners only. */
export async function PATCH(request: Request) {
  const a = await requireTimeOfficeApi({ owner: true })
  if (a.error) return a.error
  const parsed = parseTimeTrackingSettingsPatch(await request.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { error } = await mergeOrgSettings(a.admin, a.profile.org_id, parsed.set, { path: [TIME_TRACKING_SETTINGS_KEY] })
  if (error) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, settings: (await loadClockConfig(a.admin, a.profile.org_id)).settings })
}
