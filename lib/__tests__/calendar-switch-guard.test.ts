/** @jest-environment node */
import { calendarSwitchBlockReason } from '@/lib/calendar/switch-guard'

const ENV = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'SECRETS_ENCRYPTION_KEY'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  Object.assign(process.env, { MICROSOFT_CLIENT_ID: 'a', MICROSOFT_CLIENT_SECRET: 'b', SECRETS_ENCRYPTION_KEY: 'k'.repeat(40) })
})
afterEach(() => {
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))
})

function admin(opts: { google?: boolean; microsoft?: boolean; nominated?: string | null; future?: number; countError?: boolean }) {
  const from = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      not: () => b,
      gte: async () => ({ count: opts.future ?? 0, error: opts.countError ? { message: 'x' } : null }),
      maybeSingle: async () => {
        if (table === 'user_google_tokens') return { data: opts.google ? { user_id: 'u1' } : null }
        if (table === 'user_microsoft_tokens') return { data: opts.microsoft ? { user_id: 'u1' } : null }
        return { data: { install_scheduling_user_id: opts.nominated ?? null } }
      },
    }
    return b
  }
  return { from } as any
}

describe('calendarSwitchBlockReason', () => {
  it('first connect and same-provider reconnect are never blocked', async () => {
    expect(await calendarSwitchBlockReason(admin({ nominated: 'u1', future: 3 }), 'u1', 'o', 'microsoft')).toBeNull()
    expect(await calendarSwitchBlockReason(admin({ google: true, nominated: 'u1', future: 3 }), 'u1', 'o', 'google')).toBeNull()
  })
  it('a user who is not the install account can switch freely', async () => {
    expect(await calendarSwitchBlockReason(admin({ google: true, nominated: 'someone-else', future: 3 }), 'u1', 'o', 'microsoft')).toBeNull()
  })
  it('the install account with future installs cannot switch, in either direction', async () => {
    expect(await calendarSwitchBlockReason(admin({ google: true, nominated: 'u1', future: 2 }), 'u1', 'o', 'microsoft')).toMatch(/2 upcoming installs/)
    expect(await calendarSwitchBlockReason(admin({ microsoft: true, nominated: 'u1', future: 1 }), 'u1', 'o', 'google')).toMatch(/1 upcoming install is/)
  })
  it('the install account with no future installs may switch', async () => {
    expect(await calendarSwitchBlockReason(admin({ google: true, nominated: 'u1', future: 0 }), 'u1', 'o', 'microsoft')).toBeNull()
  })
  it('a failed check blocks rather than risk orphaning events', async () => {
    expect(await calendarSwitchBlockReason(admin({ google: true, nominated: 'u1', countError: true }), 'u1', 'o', 'microsoft')).toMatch(/Could not check/)
  })
})
