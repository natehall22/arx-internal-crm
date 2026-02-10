import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  let userRole = null;
  let profileError = null;
  
  if (user) {
    const { data: profile, error: pError } = await supabase
      .from('users')
      .select('role, full_name')
      .eq('id', user.id)
      .single();
    
    userRole = profile?.role;
    profileError = pError?.message;
  }

  return NextResponse.json({
    url_ok: url.startsWith("https://") && url.includes(".supabase.co"),
    anon_len: anon.length,
    auth_call_ok: !authError,
    auth_error: authError?.message ?? null,
    maps_key_len: mapsKey.length,
    maps_key_set: mapsKey.length > 0,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    user_role: userRole,
    profile_error: profileError,
  });
}