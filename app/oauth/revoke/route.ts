import { routeDeps } from '@/lib/ai-connector/deps'
import { handleRevoke } from '@/lib/ai-connector/endpoints'
import { corsHeaders } from '@/lib/ai-connector/urls'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleRevoke(request, routeDeps())
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
