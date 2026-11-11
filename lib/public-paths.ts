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
    pathname.startsWith('/pay/') ||
    pathname.startsWith('/q/') || // customer quote links (hashed per-link tokens; lib/quotes/links.ts)
    pathname.startsWith('/m/') || // automatic customer email links: visit photos + unsubscribe (hashed per-message tokens; lib/customer-messages-db.ts) // customer pay / save-card links (hashed per-link tokens; lib/online-payments/links.ts)
    // compensation agreements a new hire signs from an email (hashed per-agreement tokens; no account needed)
    pathname.startsWith('/comp-agreements/sign/') ||
    pathname.startsWith('/comp-agreements/receipt/') || // crew photo links from install invites (unguessable per-trade tokens)
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
