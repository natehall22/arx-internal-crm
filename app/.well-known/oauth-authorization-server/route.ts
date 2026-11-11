import { authorizationServerMetadata } from '@/lib/ai-connector/metadata'
import { corsHeaders, requestOrigin } from '@/lib/ai-connector/urls'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return Response.json(authorizationServerMetadata(requestOrigin(request)), { headers: corsHeaders() })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
