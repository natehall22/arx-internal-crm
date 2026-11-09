'use client'

import Link from 'next/link'

import ContactActions from '@/components/customer/ContactActions'
import LinkCustomerButton from '@/components/customers/LinkCustomerButton'
import { formatPhone } from '@/lib/format'

export default function JobCustomerRow({
  jobId,
  dealId,
  customer,
}: {
  jobId: string
  /** The job's deal — where a logged call/text/email is recorded. */
  dealId: string | null
  customer: { id: string; name: string; phone: string | null; email: string | null } | null
}) {
  if (!customer) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3 shadow-sm">
        <p className="text-sm text-[#2c2c2a]">No customer linked</p>
        <LinkCustomerButton sourceType="job" sourceId={jobId} />
      </div>
    )
  }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-white p-3 shadow-sm" data-testid="job-customer-row">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-base font-semibold text-[#2c2c2a]">{customer.name}</p>
        {customer.phone && <p className="text-sm text-[#2c2c2a]">{formatPhone(customer.phone)}</p>}
      </div>
      <div className="flex items-center gap-2">
        <ContactActions dealId={dealId} phone={customer.phone} email={customer.email} surface="job" />
        <Link
          href={`/customers/${customer.id}`}
          className="inline-flex h-11 items-center px-2 text-sm font-medium text-[#2c2c2a] underline underline-offset-2"
        >
          View customer
        </Link>
      </div>
    </div>
  )
}
