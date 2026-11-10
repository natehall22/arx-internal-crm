import { notFound } from 'next/navigation'

import { authShellCompanyFor, loadLoginCompany } from '@/lib/company-login'

import ResetPasswordForm from './ResetPasswordForm'

export const dynamic = 'force-dynamic'

/** Server shell: whose page this is comes from the web address (lib/company-login.ts), like /login. */
export default async function ResetPasswordPage() {
  const login = await loadLoginCompany()
  if (login.state === 'unknown') notFound()
  return <ResetPasswordForm company={authShellCompanyFor(login)} />
}
