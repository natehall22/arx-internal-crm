import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    maps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
}
