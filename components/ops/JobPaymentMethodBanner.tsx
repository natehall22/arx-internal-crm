/**
 * Full-bleed payment-method stripe across the top of a job.
 *
 * Colour is the whole point — ops reads this from across the room, so the method is carried by
 * background colour, not just words. Colour pairings are fixed by ops: insurance red/white,
 * cash green/black, financed orange/black (all ≥ 4.5:1 contrast).
 *
 * When nothing upstream says how the job is paid, this says so rather than guessing. A stripe
 * that confidently reads CASH on an insurance job is worse than no stripe at all.
 */

export type JobPaymentMethod = 'insurance' | 'cash' | 'finance' | null

const STYLES: Record<
  'insurance' | 'cash' | 'finance' | 'unknown',
  { bg: string; fg: string; label: string }
> = {
  insurance: { bg: '#c81e1e', fg: '#ffffff', label: 'INSURANCE' },
  cash: { bg: '#16a34a', fg: '#000000', label: 'CASH' },
  finance: { bg: '#f97316', fg: '#000000', label: 'FINANCED' },
  unknown: { bg: '#d6d4ce', fg: '#2c2c2a', label: 'PAYMENT METHOD NOT SET' },
}

/** Normalises the stored values (`insurance` / `cash` / `finance`) plus common legacy spellings. */
export function normalizeJobPaymentMethod(raw: string | null | undefined): JobPaymentMethod {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'insurance') return 'insurance'
  if (value === 'cash') return 'cash'
  if (value === 'finance' || value === 'financed' || value === 'financing') return 'finance'
  return null
}

export default function JobPaymentMethodBanner({
  paymentMethod,
}: {
  paymentMethod: string | null | undefined
}) {
  const method = normalizeJobPaymentMethod(paymentMethod)
  const style = STYLES[method ?? 'unknown']

  return (
    <div
      className="w-full px-3 py-1.5 text-center text-sm font-extrabold uppercase tracking-[0.2em]"
      style={{ backgroundColor: style.bg, color: style.fg }}
      role="status"
    >
      {style.label}
    </div>
  )
}
