/**
 * What the Customer File needs for a customer's own records (Properties card, customer Details card, Customer documents),
 * in one place for the deal Overview, the Files tab and the no-deal customer page. Server only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveCustomerAccess, type CustomerAccess } from '@/lib/customer-file/customer-access'
import { loadCustomFieldDefinitions, loadCustomFieldValues } from '@/lib/custom-fields-db'
import { definitionsForViewer, valuesForViewer, type CustomFieldDefinition } from '@/lib/custom-fields'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { listDevelopments } from '@/lib/developments-db'
import { activeTrades, loadOrgTrades } from '@/lib/org-trades'
import { loadAreaMeasurements, type AreaMeasurementRow } from '@/lib/area-measure-db'
import { resolveOpsAccess } from '@/lib/ops-access'
import { orgDb } from '@/lib/supabase/org-db'
import { loadCustomerProperties } from '@/lib/properties-db'
import { propertyDisplayName, type Property } from '@/lib/properties'
import { isFieldRole, type ThreadViewer } from '@/lib/threads/visibility'

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
  /** Yard measurement card (lawn & landscape companies only; null = the company doesn't use it). */
  areaMeasure: { rows: AreaMeasurementRow[]; canMeasure: boolean } | null
  /** Developments + lots (property tools on, viewer may edit): the company's development names and trades for the property form and "Add lots". Null = off. */
  lots: { developments: string[]; trades: Array<{ slug: string; label: string }>; canCreateJobs: boolean } | null
}

/** The ONE rule for making a job without a sale, the same the server applies (resolveOpsAccess.canCreateProductionJob). A failed read says no. */
async function canMakeJobs(admin: SupabaseClient, viewer: ThreadViewer): Promise<boolean> {
  const { data } = await orgDb(admin, viewer.orgId).from('users').select('role, custom_role_id').eq('id', viewer.userId).maybeSingle()
  if (!data) return false
  return (await resolveOpsAccess(admin, viewer.userId, data as { role: string; custom_role_id?: string | null })).canCreateProductionJob
}

/** null = the viewer may not read this customer's records (or no such customer in their company). */
export async function loadCustomerExtras(admin: SupabaseClient, viewer: ThreadViewer, customerId: string): Promise<CustomerExtras | null> {
  const access = await resolveCustomerAccess(admin, viewer, customerId)
  if (!access?.read) return null
  const [props, defs, values, plansOn, areaOn, lotsOn] = await Promise.all([
    loadCustomerProperties(admin, viewer.orgId, customerId, { includeInactive: true, accessNotes: access.accessNotes }),
    loadCustomFieldDefinitions(admin, viewer.orgId),
    loadCustomFieldValues(admin, viewer.orgId, 'customer', customerId),
    viewer.jobBoard || viewer.jobEdit || viewer.ownerLike ? isOrgFeatureOn(viewer.orgId, 'servicePlans') : Promise.resolve(false),
    isOrgFeatureOn(viewer.orgId, 'areaMeasure'),
    access.edit ? isOrgFeatureOn(viewer.orgId, 'projectTools') : Promise.resolve(false),
  ])
  const lots = lotsOn
    ? {
        developments: (await listDevelopments(admin, viewer.orgId)).map((d) => d.name),
        trades: activeTrades(await loadOrgTrades(admin, viewer.orgId)).map((t) => ({ slug: t.slug, label: t.label })),
        canCreateJobs: await canMakeJobs(admin, viewer),
      }
    : null
  // A failed read (e.g. the table is not there yet) hides the card; it never breaks the Customer File.
  const area = areaOn ? await loadAreaMeasurements(admin, viewer.orgId, { customerId }).catch(() => null) : null
  // Field roles see only fields marked visible to them (lib/custom-fields.ts definitionsForViewer) — values included.
  const visible = definitionsForViewer(defs.definitions, isFieldRole(viewer))
  const propertyFields = visible.filter((d) => d.entity === 'property')
  return {
    access,
    propertiesReady: props.ready,
    properties: props.properties.map((p) => ({ ...p, custom_fields: valuesForViewer(p.custom_fields, propertyFields) })),
    propertyOptions: props.properties.filter((p) => p.active).map((p) => ({ id: p.id, name: propertyDisplayName(p) })),
    customerFields: visible.filter((d) => d.entity === 'customer'),
    propertyFields,
    customerValues: valuesForViewer(values, visible.filter((d) => d.entity === 'customer')),
    servicePlans: plansOn,
    areaMeasure: area && area.ready ? { rows: area.rows, canMeasure: access.edit } : null,
    lots,
  }
}
