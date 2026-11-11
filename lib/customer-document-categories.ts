/** Kinds of customer-level document (client-safe; stored in documents.category). Server side: lib/customer-documents.ts. */
export const CUSTOMER_DOCUMENT_CATEGORIES = [
  { value: 'contract', label: 'Contract / agreement' },
  { value: 'misc', label: 'Document' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'warranty', label: 'Warranty' },
  { value: 'permit', label: 'Permit' },
  { value: 'insurance', label: 'Insurance certificate' },
] as const
export type CustomerDocumentCategory = (typeof CUSTOMER_DOCUMENT_CATEGORIES)[number]['value']

export function isCustomerDocumentCategory(v: unknown): v is CustomerDocumentCategory {
  return typeof v === 'string' && CUSTOMER_DOCUMENT_CATEGORIES.some((c) => c.value === v)
}
