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
