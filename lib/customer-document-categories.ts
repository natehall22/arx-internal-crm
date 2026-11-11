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

/** File types a customer document may be (contracts, photos, office files). Anything else is refused at upload. */
export const CUSTOMER_DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'doc', 'docx', 'csv'] as const
export const CUSTOMER_DOCUMENT_ACCEPT = CUSTOMER_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(',')

export function isAllowedCustomerDocumentName(name: string): boolean {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1]?.toLowerCase()
  return !!ext && (CUSTOMER_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
}
