import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

// DELETE - Delete a payment
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; paymentId: string } }
) {
  try {
    const supabase = createClient()
    const adminClient = createServiceClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await adminClient
      .from('users')
      .select('org_id, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Verify job exists and belongs to user's org
    const { data: job, error: jobError } = await adminClient
      .from('production_jobs')
      .select('id')
      .eq('id', params.id)
      .eq('org_id', profile.org_id)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Verify payment exists and belongs to this job
    const { data: payment, error: paymentError } = await adminClient
      .from('job_payments')
      .select('id')
      .eq('id', params.paymentId)
      .eq('job_id', params.id)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Delete the payment
    const { error: deleteError } = await adminClient
      .from('job_payments')
      .delete()
      .eq('id', params.paymentId)

    if (deleteError) {
      console.error('Error deleting payment:', deleteError)
      return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('Error in DELETE /api/ops/jobs/[id]/payments/[paymentId]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
