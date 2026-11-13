/**
 * Plain words for the answer to "Text pay link" (pure, client-safe) — one list for the crew page and the staff button.
 * Never says anything about the customer's number or consent record beyond what the person tapping needs.
 */
import type { PayLinkTextResult } from '@/lib/customer-messages-db'

export function payLinkTextMessage(r: Pick<PayLinkTextResult, 'status' | 'reason'>): string {
  if (r.status === 'sent') return 'Pay link texted to the customer.'
  if (r.status === 'too_many') return 'Already texted a few times this hour. Show the QR code instead.'
  if (r.status === 'off') return 'Texting isn’t set up for this company yet.'
  if (r.status === 'failed') return 'The text didn’t go through. Try again, or show the QR code.'
  switch (r.reason) {
    case 'no_consent':
      return 'We don’t have this customer’s OK to text yet.'
    case 'suppressed':
    case 'customer_opted_out':
      return 'This customer has turned texts off.'
    case 'no_address':
      return 'There’s no phone number on file for this customer.'
    case 'outside_texting_hours':
      return 'It’s outside texting hours right now.'
    case 'paid':
    case 'invoice_paid':
      return 'This invoice is already paid.'
    default:
      return 'The text couldn’t be sent.'
  }
}
