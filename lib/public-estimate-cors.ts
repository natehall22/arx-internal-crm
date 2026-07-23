import { NextResponse } from 'next/server'
import { PUBLIC_ESTIMATE_ALLOWED_ORIGINS } from '@/lib/public-estimate-config'

export function publicEstimateCorsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && (PUBLIC_ESTIMATE_ALLOWED_ORIGINS as readonly string[]).includes(origin)
      ? origin
      : PUBLIC_ESTIMATE_ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, cf-turnstile-response',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function publicEstimateOptionsResponse(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: publicEstimateCorsHeaders(origin) })
}

export function publicEstimateJson(
  body: unknown,
  status: number,
  origin: string | null
): NextResponse {
  return NextResponse.json(body, { status, headers: publicEstimateCorsHeaders(origin) })
}
