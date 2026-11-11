import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAuthContext } from '@/lib/auth'
import { checkAuthorizeRequest } from '@/lib/ai-connector/authorize'
import { appLabelForRedirect } from '@/lib/ai-connector/clients'
import { dbRateGate } from '@/lib/ai-connector/rate-limit'
import { AI_CONNECTOR_FEATURE, AI_WRITES_FEATURE, RATE_LIMITS, WRITE_SCOPE } from '@/lib/ai-connector/config'
import { signConsentTicket } from '@/lib/ai-connector/crypto'
import { makeConsentTicket } from '@/lib/ai-connector/endpoints'
import { mcpResource, originFromHeaders } from '@/lib/ai-connector/urls'
import { getRequestHostFence } from '@/lib/company-host-server'
import { getOrgBrand } from '@/lib/org-brand'
import { isOrgFeatureOn } from '@/lib/org-features-server'
import { createServiceClient } from '@/lib/supabase/service'

import AuthorizeConsent from './AuthorizeConsent'

export const dynamic = 'force-dynamic'

const KEYS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-10 text-ink">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-base">{body}</p>
    </main>
  )
}

/**
 * The page an AI app sends a person to. Public on purpose (the login redirect cannot carry a query string): signed out →
 * the request is signed into a short ticket and the person goes to sign in, then comes back through /oauth/resume.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const h = headers()
  const origin = originFromHeaders(h)
  const admin = createServiceClient()
  // This page can make us fetch a client's metadata document. Loose per-address backstop only (AI apps share addresses),
  // plus a per-app limit so one app cannot use it as a request cannon.
  const rate = dbRateGate(admin)
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const clientParam = typeof searchParams.client_id === 'string' ? searchParams.client_id.slice(0, 200) : 'none'
  const limits = [await rate(`oauth:authorize:ip:${ip}`, RATE_LIMITS.authorizePerIpPerMinute, 60), await rate(`oauth:authorize:client:${clientParam}`, RATE_LIMITS.clientTokenPerMinute, 60)]
  if (limits.some((l) => !l.ok)) return <Notice title="Too many tries" body="Wait a minute and start again from your AI app." />
  const auth = await getAuthContext()
  const fence = auth ? null : await getRequestHostFence()
  const orgId = auth?.profile.org_id ?? (fence?.kind === 'org' ? fence.orgId : null)

  if (auth && !(await isOrgFeatureOn(auth.profile.org_id, AI_CONNECTOR_FEATURE))) {
    return <Notice title="Not turned on" body="Your company has not turned on AI apps. Ask an owner to turn on the AI connector in Settings." />
  }
  const check = await checkAuthorizeRequest(admin, searchParams, { issuer: origin, resource: mcpResource(origin), orgId })
  if (!check.ok) {
    if ('redirectTo' in check) redirect(check.redirectTo)
    return <Notice title="We could not connect this app" body={check.fatal} />
  }

  const raw: Record<string, string> = {}
  for (const k of KEYS) {
    const v = searchParams[k]
    const s = Array.isArray(v) ? v[0] : v
    if (typeof s === 'string') raw[k] = s
  }
  if (!auth) {
    const ticket = signConsentTicket(raw, 'anonymous', Date.now() + 10 * 60 * 1000)
    redirect(`/login?next=${encodeURIComponent(`/oauth/resume/${ticket}`)}`)
  }

  const brand = await getOrgBrand(admin, auth.profile.org_id)
  const host = new URL(check.params.redirect_uri).host
  return (
    <AuthorizeConsent
      ticket={makeConsentTicket(raw, auth.profile.id)}
      companyName={brand.name || 'your company'}
      appLabel={appLabelForRedirect(check.client.redirect_uris)}
      claimedName={check.client.client_name}
      returnHost={host}
      asksForWrites={check.scopes.includes(WRITE_SCOPE)}
      writesAvailable={await isOrgFeatureOn(auth.profile.org_id, AI_WRITES_FEATURE)}
    />
  )
}
