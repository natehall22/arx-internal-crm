/** Who may see / change custom field values on one record (server only). Used by PATCH /api/custom-fields/values and the record pages. */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerAccess } from '@/lib/customer-file/customer-access'
import type { CustomFieldEntity } from '@/lib/custom-fields'
import { loadProperty } from '@/lib/properties-db'
import { orgDb } from '@/lib/supabase/org-db'
import { isFieldRole, type ThreadViewer } from '@/lib/threads/visibility'

/**
 * Who may change custom field values on a record. 'read' = may see the record at all (else 404, never 403).
 *  customer / property: lib/customer-file/customer-access.ts (edit = not a field role).
 *  job: the job page's own edit rule — owner/admin or jobs:edit — and never a field role.
 */
export async function customFieldRecordAccess(admin: SupabaseClient, v: ThreadViewer, entity: CustomFieldEntity, recordId: string): Promise<{ read: boolean; edit: boolean }> {
  if (entity === 'customer') {
    const a = await resolveCustomerAccess(admin, v, recordId)
    return { read: !!a?.read, edit: !!a?.edit }
  }
  if (entity === 'property') {
    const p = await loadProperty(admin, v.orgId, recordId, false)
    if (!p) return { read: false, edit: false }
    const a = await resolveCustomerAccess(admin, v, p.customer_id)
    return { read: !!a?.read, edit: !!a?.edit }
  }
  const { data: job } = await orgDb(admin, v.orgId).from('production_jobs').select('id').eq('id', recordId).maybeSingle()
  if (!job || isFieldRole(v)) return { read: false, edit: false }
  const read = v.ownerLike || v.jobBoard
  return { read, edit: read && (v.ownerLike || v.jobEdit) }
}

