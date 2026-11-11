import CustomFieldsCard from '@/components/custom-fields/CustomFieldsCard'
import CustomerDocumentsCard from '@/components/customer-file/CustomerDocumentsCard'
import PropertiesCard from '@/components/customer-file/PropertiesCard'
import { loadCustomerDocuments } from '@/lib/customer-documents'
import type { CustomerExtras } from '@/lib/customer-file/customer-extras'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * A customer's own records on the Customer File (server components; data from lib/customer-file/customer-extras.ts).
 * Every card renders nothing — or one small "add" link for people who may edit — when the company doesn't use it.
 */
export function CustomerRecords({ customerId, extras }: { customerId: string; extras: CustomerExtras }) {
  return (
    <>
      <CustomFieldsCard entity="customer" recordId={customerId} definitions={extras.customerFields} initialValues={extras.customerValues} canEdit={extras.access.edit} title="Customer details" />
      <PropertiesCard
        customerId={customerId}
        initial={extras.properties}
        ready={extras.propertiesReady}
        canEdit={extras.access.edit}
        accessNotes={extras.access.accessNotes}
        propertyFields={extras.propertyFields}
      />
    </>
  )
}

/** Customer-level documents (no job): the Files tab and the no-deal customer page. Not for pricing-barred roles. */
export async function CustomerDocuments({ customerId, orgId, extras }: { customerId: string; orgId: string; extras: CustomerExtras }) {
  if (!extras.access.documents) return null
  const docs = await loadCustomerDocuments(createServiceClient(), orgId, customerId)
  return <CustomerDocumentsCard customerId={customerId} initial={docs} canUpload={extras.access.editDocuments} properties={extras.propertyOptions} />
}
