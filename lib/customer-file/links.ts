/**
 * Where a customer opens. ONE answer for the Customers list, search and links: the Customer File (/c/<id>) once it is the
 * company's default (lib/customer-file/redirects.ts `customerFileDefaultFor`), else the older account page, exactly as before.
 * Client-safe.
 */
export function customerHref(customerId: string, customerFileDefault: boolean): string {
  return customerFileDefault ? `/c/${customerId}` : `/customers/${customerId}`
}
