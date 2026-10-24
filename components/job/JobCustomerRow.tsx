'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'

import LinkCustomerButton from '@/components/customers/LinkCustomerButton'
import { formatPhone, telHref } from '@/lib/format'

const LONG_PRESS_MS = 550

/** A 44px icon button: tap runs the action, press-and-hold copies the value. */
function ActionButton({ href, label, value, children }: { href: string; label: string; value: string; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const [copied, setCopied] = useState(false)

  const start = () => {
    held.current = false
    timer.current = setTimeout(async () => {
      held.current = true
      try {
        await navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      } catch {
        window.prompt('Copy this:', value)
      }
    }, LONG_PRESS_MS)
  }
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
  }

  return (
    <a
      href={href}
      aria-label={copied ? `${label} copied` : `${label}: ${value}. Hold to copy.`}
      title="Tap to open. Hold to copy."
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => {
        if (held.current) e.preventDefault()
      }}
      className="inline-flex h-11 min-w-[44px] select-none items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-[#2c2c2a] hover:bg-gray-50"
    >
      {children}
      <span className="sr-only sm:not-sr-only">{copied ? 'Copied' : label}</span>
    </a>
  )
}

export default function JobCustomerRow({
  jobId,
  customer,
}: {
  jobId: string
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
  const tel = customer.phone ? telHref(customer.phone) ?? `tel:${customer.phone}` : null
  const sms = tel ? tel.replace(/^tel:/, 'sms:') : null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-white p-3 shadow-sm" data-testid="job-customer-row">
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-base font-semibold text-[#2c2c2a]">{customer.name}</p>
        {customer.phone && <p className="text-sm text-[#2c2c2a]">{formatPhone(customer.phone)}</p>}
      </div>
      <div className="flex items-center gap-2">
        {tel && customer.phone && (
          <ActionButton href={tel} label="Call" value={customer.phone}>
            <span aria-hidden>📞</span>
          </ActionButton>
        )}
        {sms && customer.phone && (
          <ActionButton href={sms} label="Text" value={customer.phone}>
            <span aria-hidden>💬</span>
          </ActionButton>
        )}
        {customer.email && (
          <ActionButton href={`mailto:${customer.email}`} label="Email" value={customer.email}>
            <span aria-hidden>✉️</span>
          </ActionButton>
        )}
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
