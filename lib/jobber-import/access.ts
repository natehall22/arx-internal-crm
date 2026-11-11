/**
 * Move from Jobber — who may run it: owners only (isSuperAdmin). An import writes customers, invoices and plans
 * company-wide. Signed out → 401; signed in but not an owner → 403.
 */
import { NextResponse } from 'next/server'

import { requireAuthApi } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

export type ImportOwner = { id: string; org_id: string }

export async function importOwner(): Promise<ImportOwner | NextResponse> {
  let profile: unknown
  try {
    ;({ profile } = await requireAuthApi())
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isSuperAdmin(profile as Parameters<typeof isSuperAdmin>[0])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return profile as ImportOwner
}
