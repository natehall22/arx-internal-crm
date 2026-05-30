import { loadUsersForTransactionalEmail } from '@/lib/user-transactional-email'

describe('loadUsersForTransactionalEmail', () => {
  it('prefers auth.users email over stale public.users.email', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [{ id: 'u1', full_name: 'Jane', email: 'stale@example.com', active: true }],
              error: null,
            }),
          }),
        }),
      }),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: 'current@example.com' } },
            error: null,
          }),
        },
      },
    }

    const map = await loadUsersForTransactionalEmail(
      supabase as never,
      'org-1',
      ['u1']
    )
    expect(map.get('u1')?.resolvedEmail).toBe('current@example.com')
  })

  it('falls back to public.users when auth has no email', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: async () => ({
              data: [{ id: 'u1', full_name: 'Jane', email: 'public@example.com', active: true }],
              error: null,
            }),
          }),
        }),
      }),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email: null } }, error: null }),
        },
      },
    }

    const map = await loadUsersForTransactionalEmail(
      supabase as never,
      'org-1',
      ['u1']
    )
    expect(map.get('u1')?.resolvedEmail).toBe('public@example.com')
  })
})
