/**
 * What the Customer File needs for a customer's own records (Properties card, customer Details card, Customer documents),
 * in one place for the deal Overview, the Files tab and the no-deal customer page. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerAccess, type CustomerAccess } from '@/lib/customer-file/customer-access'
import { loadCustomFieldDefinitions, loadCustomFieldValues } from '@/lib/custom-fields-db'
import type { CustomFieldDefinition } from '@/lib/custom-fields'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { loadCustomerProperties } from '@/lib/properties-db'
import { propertyDisplayName, type Property } from '@/lib/properties'
import type { ThreadViewer } from '@/lib/threads/visibility'

export type CustomerExtras = {
  access: CustomerAccess
  propertiesReady: boolean
  properties: Property[]
  propertyOptions: Array<{ id: string; name: string }>
  customerFields: CustomFieldDefinition[]
  propertyFields: CustomFieldDefinition[]
  customerValues: Record<string, unknown>
  /** Show the Service plans card: the company uses service plans and the viewer works the job board. The API decides what they may do. */
  servicePlans: boolean
}

/** null = the viewer may not read this customer's records (or no such customer in their company). */
export async function loadCustomerExtras(admin: SupabaseClient, viewer: ThreadViewer, customerId: string): Promise<CustomerExtras | null> {
  const access = await resolveCustomerAccess(admin, viewer, customerId)
  if (!access?.read) return null
  const [props, defs, values, plansOn] = await Promise.all([
    loadCustomerProperties(admin, viewer.orgId, customerId, { includeInactive: true, accessNotes: access.accessNotes }),
    loadCustomFieldDefinitions(admin, viewer.orgId),
    loadCustomFieldValues(admin, viewer.orgId, 'customer', customerId),
    viewer.jobBoard || viewer.jobEdit || viewer.ownerLike ? isOrgFeatureOn(viewer.orgId, 'servicePlans') : Promise.resolve(false),
  ])
  return {
    access,
    propertiesReady: props.ready,
    properties: props.properties,
    propertyOptions: props.properties.filter((p) => p.active).map((p) => ({ id: p.id, name: propertyDisplayName(p) })),
    customerFields: defs.definitions.filter((d) => d.entity === 'customer'),
    propertyFields: defs.definitions.filter((d) => d.entity === 'property'),
    customerValues: values ?? {},
    servicePlans: plansOn,
  }
}
