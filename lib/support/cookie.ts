import type { NextResponse } from 'next/server'

import { SUPPORT_COOKIE, signSupportToken, type SupportSessionPayload } from '@/lib/support/token'

/** Set the support session cookie: host-only (no Domain), httpOnly, never past the payload's own expiry. */
export async function setSupportCookie(res: NextResponse, payload: SupportSessionPayload, secure: boolean): Promise<void> {
  const value = await signSupportToken({ ...payload, k: 'session' })
  if (!value) throw new Error('support cookie could not be signed')
  res.cookies.set(SUPPORT_COOKIE, value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: Math.max(1, Math.floor((payload.exp - Date.now()) / 1000)) })
}

export function clearSupportCookie(res: NextResponse, secure: boolean): void {
  res.cookies.set(SUPPORT_COOKIE, '', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 })
}
