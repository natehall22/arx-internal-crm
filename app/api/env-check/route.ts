import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  // Require authentication — this endpoint reveals internal configuration details
  let profile;
  try {
    ({ profile } = await requireAuthApi());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRole = profile.role;

  // Only admins can access this diagnostic endpoint
  if (!['admin', 'regional_manager', 'sales_manager'].includes(userRole ?? '')) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    url_ok: url.startsWith("https://") && url.includes(".supabase.co"),
    anon_len: anon.length,
    maps_key_len: mapsKey.length,
    maps_key_set: mapsKey.length > 0,
    user_id: profile.id,
    user_email: profile.email,
    user_role: userRole,
  });
}