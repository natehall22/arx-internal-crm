export type PaymentType = 
  | 'deposit'
  | 'insurance_acv'
  | 'insurance_supplement'
  | 'deductible'
  | 'final'
  | 'other'

export type PaymentMethod = 
  | 'check'
  | 'cash'
  | 'ach'
  | 'card'
  | 'financing'
  | 'insurance'
  | 'other'

export type PaymentPayer =
  | 'homeowner'
  | 'insurance'
  | 'financing'
  | 'other'

/** See `lib/weekly-payroll/explicit-rules.ts` — cleared counts toward fully funded; pending does not. */
export type FundingStatus = 'pending' | 'cleared'

export interface JobPayment {
  id: string
  job_id: string
  paid_at: string
  amount_cents: number
  payment_type: PaymentType
  method: PaymentMethod
  payer: PaymentPayer
  note: string | null
  created_at: string
  created_by: string | null
  funding_status?: FundingStatus
  /** When set, second insert with same (job_id, idempotency_key) is a duplicate and must be rejected. */
  idempotency_key?: string | null
}

export interface JobPaymentInsert {
  job_id: string
  paid_at: string
  amount_cents: number
  payment_type: PaymentType
  method: PaymentMethod
  payer: PaymentPayer
  note?: string | null
  created_by?: string | null
  funding_status?: FundingStatus
  idempotency_key?: string | null
}

export interface JobPaymentSummary {
  payments: JobPayment[]
  collected_cents: number
  collected_dollars: number
  sale_amount_cents: number
  sale_amount_dollars: number
  remaining_cents: number
  remaining_dollars: number
  payment_count: number
  /** lib/job-collection.ts: payments within $0.05 of the sale amount, or super-admin forced. */
  paid_in_full?: boolean
  paid_by_payments?: boolean
  forced_paid_in_full?: boolean
  /** Old "close with balance" flag with no super admin on record — does not count as paid. */
  legacy_close_with_balance?: boolean
}

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  deposit: 'Deposit',
  insurance_acv: 'Insurance ACV',
  insurance_supplement: 'Insurance Supplement',
  deductible: 'Deductible',
  final: 'Final Payment',
  other: 'Other',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: 'Check',
  cash: 'Cash',
  ach: 'ACH/Bank Transfer',
  card: 'Credit/Debit Card',
  financing: 'Financing',
  insurance: 'Insurance',
  other: 'Other',
}

export const PAYMENT_PAYER_LABELS: Record<PaymentPayer, string> = {
  homeowner: 'Homeowner',
  insurance: 'Insurance',
  financing: 'Financing',
  other: 'Other',
}
