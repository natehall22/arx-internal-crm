import type { AbcEnvironment } from '@/lib/suppliers/abc/types'

/**
 * Global kill switch #1 (of three: this env var, the org switch, the supplier switch). Unset = OFF.
 * Server-only. Flip it in Vercel; no deploy of code is needed.
 */
export function abcGloballyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SUPPLIER_API_ORDERING === 'on'
}

const BASE: Record<AbcEnvironment, string> = {
  sandbox: 'https://partners-sb.abcsupply.com',
  production: 'https://partners.abcsupply.com',
}
// Token endpoints exactly as printed in ABC's Individual Business guide. The sandbox one has no
// "/v1/token" suffix on that page while production does — confirm against the sandbox on first use.
const TOKEN_URL: Record<AbcEnvironment, string> = {
  sandbox: 'https://sandbox.auth.partners.abcsupply.com/oauth2/aus1vp07knpuqf6Xz0h8/v1/token',
  production: 'https://auth.partners.abcsupply.com/oauth2/ausvvp0xuwGKLenYy357/v1/token',
}

export const ABC_SCOPES = 'order.write'

export function abcBaseUrl(environment: AbcEnvironment): string {
  return BASE[environment]
}
export function abcTokenUrl(environment: AbcEnvironment, env: NodeJS.ProcessEnv = process.env): string {
  return env.ABC_TOKEN_URL_OVERRIDE_SANDBOX && environment === 'sandbox' ? env.ABC_TOKEN_URL_OVERRIDE_SANDBOX : TOKEN_URL[environment]
}

/** Credentials live in env vars (Vercel "Sensitive"), never in the database and never in a log. */
export function abcCredentials(environment: AbcEnvironment, env: NodeJS.ProcessEnv = process.env): { clientId: string; clientSecret: string } | null {
  const suffix = environment === 'production' ? 'PRODUCTION' : 'SANDBOX'
  const clientId = env[`ABC_CLIENT_ID_${suffix}`]
  const clientSecret = env[`ABC_CLIENT_SECRET_${suffix}`]
  return clientId && clientSecret ? { clientId, clientSecret } : null
}
