/**
 * The public address of THIS request (the company's own address) and the identifiers built from it. The token's
 * `resource` is the MCP address; a token for one company address is refused on any other.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const host = request.headers.get('host') ?? url.host
  const hostname = host.split(':')[0]
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : hostname === 'localhost' || hostname === '127.0.0.1' ? 'http' : 'https'
  return `${proto}://${host}`
}

export const mcpResource = (origin: string) => `${origin}/mcp`
export const protectedResourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`

export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
    'access-control-expose-headers': 'www-authenticate',
    'cache-control': 'no-store',
    ...extra,
  }
}

/** Same as requestOrigin, from the headers of a server-rendered page (no Request object there). */
export function originFromHeaders(h: Headers, fallbackHost = 'localhost'): string {
  const host = h.get('host') ?? fallbackHost
  const hostname = host.split(':')[0]
  const forwarded = h.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : hostname === 'localhost' || hostname === '127.0.0.1' ? 'http' : 'https'
  return `${proto}://${host}`
}
