/**
 * Cloudflare Turnstile verification for public estimate endpoints.
 * When the estimate funnel is enabled, a Turnstile secret is required
 * (fail closed). Local unit tests can pass `skipIfUnset`.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null,
  options?: { allowSkipIfUnset?: boolean }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY || process.env.PUBLIC_ESTIMATE_TURNSTILE_SECRET
  if (!secret) {
    if (options?.allowSkipIfUnset || process.env.NODE_ENV === 'test') {
      return { ok: true }
    }
    // Fail closed when funnel is on in non-test environments.
    if (process.env.PUBLIC_ROOF_ESTIMATE_ENABLED === 'true') {
      return { ok: false, reason: 'turnstile_not_configured' }
    }
    return { ok: true }
  }
  if (!token || !token.trim()) {
    return { ok: false, reason: 'missing_turnstile' }
  }

  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token.trim())
    if (remoteIp) form.set('remoteip', remoteIp)

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (!data.success) {
      return { ok: false, reason: data['error-codes']?.[0] || 'turnstile_failed' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[public-estimate] turnstile verify failed:', err)
    return { ok: false, reason: 'turnstile_error' }
  }
}

export function requireTurnstileOnPreview(): boolean {
  // Default ON whenever the public funnel is enabled.
  if (process.env.PUBLIC_ESTIMATE_TURNSTILE_ON_PREVIEW === 'false') return false
  return process.env.PUBLIC_ROOF_ESTIMATE_ENABLED === 'true'
}
