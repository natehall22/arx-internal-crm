/** Move from Jobber — who may run it: owners only (isSuperAdmin). An import writes customers, invoices and plans company-wide. */
import { requireAuthApi } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/super-admin'

export async function importOwner(): Promise<{ id: string; org_id: string } | null> {
  try {
    const { profile } = await requireAuthApi()
    return isSuperAdmin(profile) ? (profile as { id: string; org_id: string }) : null
  } catch {
    return null
  }
}
