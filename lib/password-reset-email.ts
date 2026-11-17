import type { SupabaseClient } from '@supabase/supabase-js'

import { orgAppUrl } from '@/lib/company-links'
import { PRODUCT_NAME } from '@/lib/product'
import { getCrmEmailFrom, getMailTransport } from '@/lib/setter-email'

export type PasswordResetResult = { ok: true } | { ok: false; reason: 'no_app_url' | 'link_failed' }

/**
 * THE one way a password reset link is made and mailed: an administrator's "send reset" (app/api/admin/users) and the
 * sign-in page's "Email me a reset link" (app/api/auth/forgot-password) both come here. The link lands on the company's own
 * /reset-password page (the app address must be on Supabase Auth's redirect allow-list, docs/domain-cutover.md). The app
 * address is checked before a recovery token is minted. Mail errors throw.
 */
export async function sendPasswordResetEmail(
  admin: SupabaseClient,
  args: { orgId: string; email: string; intro: string }
): Promise<PasswordResetResult> {
  let appUrl: string
  try {
    appUrl = await orgAppUrl(args.orgId)
  } catch {
    return { ok: false, reason: 'no_app_url' }
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: args.email,
  })
  if (linkError || !linkData?.properties?.action_link) {
    console.error('Generate link error:', linkError)
    return { ok: false, reason: 'link_failed' }
  }

  // Replace Supabase's redirect with the company's own reset-password page
  const finalLink = linkData.properties.action_link.replace(
    /redirect_to=[^&]*/,
    `redirect_to=${encodeURIComponent(`${appUrl}/reset-password`)}`
  )

  await getMailTransport(args.orgId).sendMail({
    from: await getCrmEmailFrom(args.orgId),
    to: args.email,
    subject: `Reset your ${PRODUCT_NAME} password`,
    html: `
        <p>${args.intro}</p>
        <p><a href="${finalLink}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset Password</a></p>
        <p style="color:#6B7280;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
      `,
  })
  return { ok: true }
}
