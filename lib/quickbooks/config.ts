/**
 * QuickBooks Online (Intuit) — server configuration. Names only; values live in env (docs/quickbooks-sync.md "Env").
 * One app (client id/secret) serves every company; each company connects its own QuickBooks company (realm).
 */
export const QB_SCOPE = 'com.intuit.quickbooks.accounting'
export const QB_MINOR_VERSION = 75

export const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke'

export type QbEnvironment = 'sandbox' | 'production'

export type QbConfig = { clientId: string; clientSecret: string; redirectUri: string; environment: QbEnvironment }

/** The app's Intuit settings, or null when this server isn't set up for QuickBooks (any piece missing). */
export function quickBooksConfig(): QbConfig | null {
  const clientId = process.env.INTUIT_CLIENT_ID?.trim()
  const clientSecret = process.env.INTUIT_CLIENT_SECRET?.trim()
  const redirectUri = process.env.INTUIT_REDIRECT_URI?.trim()
  const environment = process.env.INTUIT_ENVIRONMENT?.trim() === 'production' ? 'production' : process.env.INTUIT_ENVIRONMENT?.trim() === 'sandbox' ? 'sandbox' : null
  if (!clientId || !clientSecret || !redirectUri || !environment) return null
  return { clientId, clientSecret, redirectUri, environment }
}

export function quickBooksApiBase(environment: QbEnvironment): string {
  return environment === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'
}
