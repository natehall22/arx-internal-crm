import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role only. Lets the browser upload large files without a Supabase session JWT
 * (avoids storage.objects RLS on user INSERT when the CRM session is cookie-only).
 */
export async function signedUploadTokenForPath(
  supabase: SupabaseClient,
  bucket: string,
  path: string
): Promise<{ token: string } | { error: string }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path)
  if (error || !data?.token) {
    return { error: error?.message || 'Could not create signed upload URL' }
  }
  return { token: data.token }
}
