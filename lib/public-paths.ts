/**
 * Paths a logged-out visitor can load. Single source for both middleware
 * (skip the session check) and the root layout's client chrome (don't mount
 * session-only widgets — AI assistant, notification stream, keepalive — so
 * public pages make no authed API calls). Every other page is gated by
 * middleware, so reaching it means a session cookie was present.
 *
 * Edge-runtime safe: no imports.
 */
export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return (
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/trial' ||
    pathname === '/reset-password' ||
    pathname === '/privacy' ||
    pathname === '/terms' ||
    pathname.startsWith('/login/') ||
    pathname.startsWith('/contracts/') ||
    pathname.startsWith('/change-orders/sign/') ||
    pathname.startsWith('/r/') || // public inspection-report share links (unguessable tokens)
    pathname.startsWith('/crew/') ||
    pathname.startsWith('/po/') || // a vendor's one-tap purchase-order confirm link (hashed per-send tokens; lib/purchase-orders-db.ts)
    pathname.startsWith('/s/') || // customer selection links (unguessable per-selection tokens; lib/project-tools/selections-public.ts)
    pathname.startsWith('/pay/') || // customer pay / save-card links (hashed per-link tokens; lib/online-payments/links.ts)
    pathname.startsWith('/m/') || // automatic customer email links: visit photos + unsubscribe (hashed per-message tokens; lib/customer-messages-db.ts)
    pathname === '/portal' ||
    pathname.startsWith('/portal/') || // customer portal: its own magic-link session (lib/portal/server.ts), never staff auth
    // compensation agreements a new hire signs from an email (hashed per-agreement tokens; no account needed)
    pathname.startsWith('/comp-agreements/sign/') ||
    pathname.startsWith('/comp-agreements/receipt/') || // crew photo links from install invites (unguessable per-trade tokens)
    // AI connector (lib/ai-connector): discovery, sign-in endpoints and the MCP endpoint do their own bearer-token / ticket checks.
    // /oauth/authorize is public so it can keep its query string through sign-in; /oauth/resume is NOT (it needs the session).
    pathname.startsWith('/.well-known/') ||
    pathname === '/oauth/authorize' ||
    pathname === '/oauth/token' ||
    pathname === '/oauth/register' ||
    pathname === '/oauth/revoke' ||
    pathname === '/mcp' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.endsWith('.json') ||
    pathname.endsWith('.js') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.css')
  )
}
