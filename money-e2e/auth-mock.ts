/** "Who is signed in" for route handlers: the ONE thing this suite fakes about the app. Everything behind requireAuthApi is real. */
import { createServiceClient } from '@/lib/supabase/service'

export const signedIn: { userId: string | null } = { userId: null }
export const signInAs = (userId: string | null) => { signedIn.userId = userId }

async function context() {
  if (!signedIn.userId) throw new Error('Unauthorized')
  const { data } = await createServiceClient().from('users').select('*').eq('id', signedIn.userId).single()
  if (!data) throw new Error('Unauthorized')
  return { authUser: { id: signedIn.userId, email: (data as any).email }, profile: data as any }
}

export function mockAuthModule() {
  const actual = jest.requireActual('@/lib/auth')
  return { ...actual, requireAuthApi: context, requireAuth: context, getAuthContext: () => context().catch(() => null) }
}
