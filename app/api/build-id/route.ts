import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** The deployed commit, so an open canvass page can tell a newer build is live. Public on purpose; it is only a commit id. */
export async function GET() {
  return NextResponse.json({ id: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' }, { headers: { 'Cache-Control': 'no-store' } })
}
