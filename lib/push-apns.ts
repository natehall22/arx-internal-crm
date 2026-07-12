import http2 from 'http2'
import { SignJWT, importPKCS8 } from 'jose'
import { createClient } from '@supabase/supabase-js'
import { waitUntil } from '@vercel/functions'

/**
 * APNs sender for ARX Sales (com.arx.ARX-Sales).
 *
 * Why not apns2? That client maintains a persistent HTTP/2 connection pool
 * (`keepAlive`), which is a poor fit for Vercel serverless (short-lived
 * invocations, no durable sockets). We use Node's built-in `http2` for a
 * one-shot request per send instead — same APNs JWT auth, works in Node 18+.
 *
 * Env: APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (p8 PEM), APNS_BUNDLE_ID,
 *      APNS_ENVIRONMENT ('sandbox' | 'production').
 */

export type PushPayload = {
  type?: string
  appointment_id?: string
  [key: string]: unknown
}

type DeviceTokenRow = {
  id: string
  device_token: string
  environment: string
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function apnsHost(environment: string): string {
  return environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com'
}

function normalizePrivateKey(raw: string): string {
  // Vercel env often stores newlines as literal \n
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

let cachedJwt: { token: string; exp: number } | null = null

async function getApnsJwt(): Promise<string | null> {
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const privateKeyPem = process.env.APNS_PRIVATE_KEY
  if (!keyId || !teamId || !privateKeyPem) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwt.exp > now + 60) {
    return cachedJwt.token
  }

  try {
    const key = await importPKCS8(normalizePrivateKey(privateKeyPem), 'ES256')
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(now)
      .sign(key)
    // APNs JWTs are valid up to 1 hour — refresh early.
    cachedJwt = { token, exp: now + 50 * 60 }
    return token
  } catch (err) {
    console.error('[push-apns] Failed to sign JWT:', err)
    return null
  }
}

function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID &&
      process.env.APNS_TEAM_ID &&
      process.env.APNS_PRIVATE_KEY &&
      (process.env.APNS_BUNDLE_ID || 'com.arx.ARX-Sales')
  )
}

type ApnsSendResult =
  | { ok: true }
  | { ok: false; status: number; reason?: string; unregistered: boolean }

async function sendApnsHttp2(opts: {
  deviceToken: string
  environment: string
  jwt: string
  title: string
  body: string
  payload: PushPayload
}): Promise<ApnsSendResult> {
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.arx.ARX-Sales'
  const host = apnsHost(opts.environment)
  const path = `/3/device/${opts.deviceToken}`
  const apnsBody = JSON.stringify({
    aps: {
      alert: { title: opts.title, body: opts.body },
      sound: 'default',
    },
    ...opts.payload,
  })

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: ApnsSendResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let client: http2.ClientHttp2Session
    try {
      client = http2.connect(`https://${host}`)
    } catch (err) {
      console.error('[push-apns] http2.connect failed:', err)
      finish({ ok: false, status: 0, unregistered: false })
      return
    }

    client.on('error', (err) => {
      console.error('[push-apns] session error:', err)
      finish({ ok: false, status: 0, unregistered: false })
    })

    const req = client.request({
      ':method': 'POST',
      ':path': path,
      authorization: `bearer ${opts.jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    })

    let status = 0
    let responseData = ''

    req.setEncoding('utf8')
    req.on('response', (headers) => {
      status = Number(headers[':status'] || 0)
    })
    req.on('data', (chunk) => {
      responseData += chunk
    })
    req.on('end', () => {
      client.close()
      if (status >= 200 && status < 300) {
        finish({ ok: true })
        return
      }
      let reason: string | undefined
      try {
        reason = JSON.parse(responseData)?.reason
      } catch {
        reason = responseData || undefined
      }
      const unregistered =
        status === 410 ||
        reason === 'Unregistered' ||
        reason === 'BadDeviceToken' ||
        reason === 'DeviceTokenNotForTopic'
      finish({ ok: false, status, reason, unregistered })
    })
    req.on('error', (err) => {
      console.error('[push-apns] request error:', err)
      try {
        client.close()
      } catch {
        /* ignore */
      }
      finish({ ok: false, status: 0, unregistered: false })
    })

    req.end(apnsBody)
  })
}

async function deleteTokenRow(id: string): Promise<void> {
  try {
    const admin = getAdminClient()
    await admin.from('mobile_device_tokens').delete().eq('id', id)
  } catch (err) {
    console.error('[push-apns] Failed to delete stale token:', err)
  }
}

/**
 * Best-effort push to all of a user's registered devices.
 * Never throws — callers should fire-and-forget so push failures never break business requests.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  payload: PushPayload = {}
): Promise<void> {
  try {
    if (!isApnsConfigured()) {
      console.warn('[push-apns] Skipping send — APNs env vars not configured')
      return
    }

    const jwt = await getApnsJwt()
    if (!jwt) return

    const admin = getAdminClient()
    const { data: tokens, error } = await admin
      .from('mobile_device_tokens')
      .select('id, device_token, environment')
      .eq('user_id', userId)
      .eq('platform', 'ios')

    if (error) {
      console.error('[push-apns] Failed to load device tokens:', error)
      return
    }

    const rows = (tokens || []) as DeviceTokenRow[]
    if (rows.length === 0) return

    const defaultEnv = process.env.APNS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production'

    await Promise.all(
      rows.map(async (row) => {
        // Prefer per-device environment (set at registration); fall back to server default only if unset.
        const env =
          row.environment === 'sandbox' || row.environment === 'production'
            ? row.environment
            : defaultEnv
        const result = await sendApnsHttp2({
          deviceToken: row.device_token,
          environment: env,
          jwt,
          title,
          body,
          payload,
        })
        if (!result.ok) {
          console.error('[push-apns] Send failed', {
            userId,
            status: result.status,
            reason: result.reason,
            environment: env,
          })
          if (result.unregistered) {
            await deleteTokenRow(row.id)
          }
        }
      })
    )
  } catch (err) {
    console.error('[push-apns] sendPushToUser unexpected error:', err)
  }
}

/** Extends the Vercel invocation until the send finishes (or fails). */
export function sendPushToUserBackground(
  userId: string,
  title: string,
  body: string,
  payload: PushPayload = {}
): void {
  waitUntil(sendPushToUser(userId, title, body, payload))
}
