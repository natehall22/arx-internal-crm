import { handleMcpPost, originAllowed } from '@/lib/ai-connector/mcp'
import { routeDeps } from '@/lib/ai-connector/deps'

export const dynamic = 'force-dynamic'

function withCors(request: Request, res: Response): Response {
  const origin = request.headers.get('origin')
  if (origin && originAllowed(request)) {
    res.headers.set('access-control-allow-origin', origin)
    res.headers.set('vary', 'Origin')
    res.headers.set('access-control-expose-headers', 'www-authenticate')
  }
  return res
}

/** MCP Streamable HTTP, POST only (no server-sent event stream, no sessions). */
export async function POST(request: Request) {
  return withCors(request, await handleMcpPost(request, routeDeps()))
}

export async function GET() {
  return new Response(null, { status: 405, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } })
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } })
}

export async function OPTIONS(request: Request) {
  if (!originAllowed(request)) return new Response(null, { status: 403 })
  const res = new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-max-age': '600' } })
  return withCors(request, res)
}
