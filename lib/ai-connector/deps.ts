import { getRequestHostFence } from '@/lib/company-host-server'
import { createServiceClient } from '@/lib/supabase/service'

/** Real dependencies for the route handlers. The fence is the company web address only (never the iPhone company-code header). */
export function routeDeps() {
  return { admin: createServiceClient(), fence: getRequestHostFence }
}
