export const dynamic = 'force-dynamic'

import { createClient } from '@supabase/supabase-js'
import CustomerSigningForm from './CustomerSigningForm'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function ChangeOrderSigningPage({
  params,
}: {
  params: { token: string }
}) {
  const supabase = getAdminClient()

  const { data: changeOrder } = await supabase
    .from('job_change_orders')
    .select('id, co_number, description, customer_print_name, status, token_expires_at, updated_total')
    .eq('signing_token', params.token)
    .single()

  if (!changeOrder) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Not Found</h1>
          <p className="text-gray-600">This change order link is invalid.</p>
        </div>
      </div>
    )
  }

  if (changeOrder.token_expires_at && new Date(changeOrder.token_expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600">This signing link has expired. Please contact ARX Roofing.</p>
        </div>
      </div>
    )
  }

  if (changeOrder.status === 'completed') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Already Signed</h1>
          <p className="text-gray-600">This change order has already been signed.</p>
        </div>
      </div>
    )
  }

  return <CustomerSigningForm changeOrder={changeOrder} token={params.token} />
}
