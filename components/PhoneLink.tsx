import { formatPhone, telHref } from '@/lib/format'

/**
 * A phone number as people read it, (704) 903-8092, and tap-to-call on a phone.
 * The one component for any phone on screen; formatting lives in lib/format.ts. Prints "—" (or `empty`) when there is no number.
 */
export default function PhoneLink({ value, className, empty = '—' }: { value: string | null | undefined; className?: string; empty?: string }) {
  const href = telHref(value)
  if (!value || !href) return <>{value ? formatPhone(value) : empty}</>
  return (
    <a href={href} className={className ?? 'inline-flex min-h-tap items-center text-brand-800 underline-offset-2 hover:underline'}>
      {formatPhone(value)}
    </a>
  )
}
