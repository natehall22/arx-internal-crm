import { SupabaseClient } from '@supabase/supabase-js'
import { JobPayment, JobPaymentSummary, JobPaymentInsert } from './types/job-payments'

/**
 * Fetch all payments for a job and calculate summary
 */
export async function getJobPaymentSummary(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobPaymentSummary | null> {
  // Fetch job to get sale_amount
  const { data: job, error: jobError } = await supabase
    .from('production_jobs')
    .select('sale_amount')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    console.error('Error fetching job:', jobError)
    return null
  }

  // Fetch all payments for this job
  const { data: payments, error: paymentsError } = await supabase
    .from('job_payments')
    .select('*')
    .eq('job_id', jobId)
    .order('paid_at', { ascending: true })

  if (paymentsError) {
    console.error('Error fetching payments:', paymentsError)
    return null
  }

  const paymentList = (payments || []) as JobPayment[]
  const saleAmountCents = Math.round((job.sale_amount || 0) * 100)
  const collectedCents = paymentList.reduce((sum, p) => sum + p.amount_cents, 0)
  const remainingCents = saleAmountCents - collectedCents

  return {
    payments: paymentList,
    collected_cents: collectedCents,
    collected_dollars: collectedCents / 100,
    sale_amount_cents: saleAmountCents,
    sale_amount_dollars: saleAmountCents / 100,
    remaining_cents: remainingCents,
    remaining_dollars: remainingCents / 100,
    payment_count: paymentList.length,
  }
}

/**
 * Add a payment to a job
 */
export async function addJobPayment(
  supabase: SupabaseClient,
  payment: JobPaymentInsert
): Promise<JobPayment | null> {
  const { data, error } = await supabase
    .from('job_payments')
    .insert(payment)
    .select()
    .single()

  if (error) {
    console.error('Error adding payment:', error)
    return null
  }

  return data as JobPayment
}

/**
 * Delete a payment
 */
export async function deleteJobPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<boolean> {
  const { error } = await supabase
    .from('job_payments')
    .delete()
    .eq('id', paymentId)

  if (error) {
    console.error('Error deleting payment:', error)
    return false
  }

  return true
}

/**
 * Format cents as currency string
 */
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}
