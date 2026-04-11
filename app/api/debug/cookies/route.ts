import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  // If someone opens the API route in the browser, send them to the real login UI
  return NextResponse.redirect(new URL('/login', request.url), { status: 302 })
}
