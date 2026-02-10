import { NextResponse } from 'next/server'

export async function GET() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('arx_cookie_test', '1', {
    path: '/',
    sameSite: 'lax',
  })
  res.headers.set('X-COOKIE-TEST', 'hit')
  return res
}
