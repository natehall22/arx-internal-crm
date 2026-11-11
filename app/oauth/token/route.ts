import { routeDeps } from '@/lib/ai-connector/deps'
import { handleToken } from '@/lib/ai-connector/endpoints'
import { corsHeaders } from '@/lib/ai-connector/urls'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handleToken(request, routeDeps())
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
