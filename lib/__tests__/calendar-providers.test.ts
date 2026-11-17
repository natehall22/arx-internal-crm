/** @jest-environment node */
import { googleClient } from '@/lib/calendar/google-provider'
import {
  allDayBusy,
  graphUtcToIso,
  microsoftClient,
  resultFromSchedule,
  rsvpOf,
  toGraphEvent,
  toGraphTime,
} from '@/lib/calendar/microsoft-calendar'
import { calendarConnectedUserIds, disconnectCalendar, getCalendarClient, saveMicrosoftConnection } from '@/lib/calendar/connection'
import { createCalendarEvent } from '@/lib/google-calendar'
import { isMissingEventError, isStaleEventIdError, CalendarApiError } from '@/lib/calendar/provider'
import { GoogleCalendarError } from '@/lib/google-calendar'
import { acceptOAuthCallback, issueOAuthState, pkceFor } from '@/lib/google-oauth-state'
import { resolveSubShareStatus, busyDatesFromSlots } from '@/lib/sub-availability'
import { integrationSecretKey, openWithKey, sealWithKey } from '@/lib/secret-seal'

const ENV = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'SECRETS_ENCRYPTION_KEY', 'OAUTH_STATE_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const
const saved: Record<string, string | undefined> = {}
const realFetch = global.fetch

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  Object.assign(process.env, {
    MICROSOFT_CLIENT_ID: 'mid',
    MICROSOFT_CLIENT_SECRET: 'msec',
    SECRETS_ENCRYPTION_KEY: 'k'.repeat(40),
    OAUTH_STATE_SECRET: 'state-secret',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsec',
  })
})
afterEach(() => {
  global.fetch = realFetch
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

type Call = { url: string; method: string; body?: any; headers: Record<string, string> }
function mockFetch(handler: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (url: any, init: any = {}) => {
    const c: Call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body }
    calls.push(c)
    const r = handler(c)
    const status = r.status ?? 200
    return { ok: status < 400, status, headers: { get: () => null }, json: async () => r.json ?? {}, text: async () => JSON.stringify(r.json ?? {}) } as unknown as Response
  }) as unknown as typeof fetch
  return calls
}

describe('provider contract', () => {
  it('both providers expose the same client surface', () => {
    const g = googleClient('t')
    const m = microsoftClient('t')
    expect(Object.keys(m).sort()).toEqual(Object.keys(g).sort())
    expect(g.provider).toBe('google')
    expect(m.provider).toBe('microsoft')
    for (const k of Object.keys(g)) expect(typeof (m as any)[k]).toBe(typeof (g as any)[k])
  })

  it('a missing event is recognised for either provider', () => {
    expect(isMissingEventError(new GoogleCalendarError('x', 404))).toBe(true)
    expect(isMissingEventError(new CalendarApiError('x', 410))).toBe(true)
    expect(isMissingEventError(new CalendarApiError('x', 500))).toBe(false)
  })
})

describe('Google parity', () => {
  it('the client sends exactly what the legacy function sends', async () => {
    const event = { summary: 'Inspection: A', start: { dateTime: '2026-11-02T10:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-11-02T11:00:00', timeZone: 'America/New_York' }, attendees: [{ email: 'a@b.co' }] }
    const legacy = mockFetch(() => ({ json: { id: 'e1' } }))
    await createCalendarEvent('tok', event, 'primary', 'all')
    const viaClient = mockFetch(() => ({ json: { id: 'e1' } }))
    await googleClient('tok').createEvent(event, 'primary', 'all')
    expect(viaClient).toEqual(legacy)
  })
})

describe('Microsoft times and DST (always UTC on the wire)', () => {
  it.each([
    // spring forward 2026-03-08 02:00 EST -> 03:00 EDT
    ['2026-03-08T01:30:00', 'America/New_York', '2026-03-08T06:30:00'],
    ['2026-03-08T03:30:00', 'America/New_York', '2026-03-08T07:30:00'],
    // fall back 2026-11-01 02:00 EDT -> 01:00 EST
    ['2026-11-01T00:30:00', 'America/New_York', '2026-11-01T04:30:00'],
    ['2026-11-01T03:00:00', 'America/New_York', '2026-11-01T08:00:00'],
    ['2026-11-02T10:00:00-05:00', undefined, '2026-11-02T15:00:00'],
    ['2026-07-02T10:00:00Z', 'America/New_York', '2026-07-02T10:00:00'],
  ])('%s %s -> %s', (dateTime, timeZone, utc) => {
    expect(toGraphTime({ dateTime, timeZone })).toEqual({ time: { dateTime: utc, timeZone: 'UTC' }, allDay: false })
  })

  it('all-day events are a bare date at midnight in the ORG time zone, never shifted', () => {
    expect(toGraphTime({ date: '2026-11-01' })).toEqual({ time: { dateTime: '2026-11-01T00:00:00', timeZone: 'America/New_York' }, allDay: true })
    expect(toGraphTime({ date: '2026-11-01' }, 'America/Chicago').time.timeZone).toBe('America/Chicago')
    const g = toGraphEvent({ summary: 's', start: { date: '2026-03-08' }, end: { date: '2026-03-09' } }, 'all')
    expect(g).toMatchObject({ isAllDay: true, start: { dateTime: '2026-03-08T00:00:00', timeZone: 'America/New_York' }, end: { dateTime: '2026-03-09T00:00:00', timeZone: 'America/New_York' } })
  })

  it('all-day busy is the org-local day across both DST changes, however Graph expresses it', () => {
    // Nov 1 2026 (fall back): midnight EDT (04:00Z) to midnight EST next day (05:00Z) = 25 hours
    expect(allDayBusy('2026-11-01T04:00:00.0000000', '2026-11-02T05:00:00.0000000')).toEqual({ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' })
    // Mar 8 2026 (spring forward): midnight EST (05:00Z) to midnight EDT (04:00Z) = 23 hours
    expect(allDayBusy('2026-03-08T05:00:00.0000000', '2026-03-09T04:00:00.0000000')).toEqual({ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' })
    // Floating UTC midnight (date only) lands on the same org-local day
    expect(allDayBusy('2026-11-01T00:00:00.0000000', '2026-11-02T00:00:00.0000000')).toEqual({ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' })
    expect(allDayBusy('2026-03-08T00:00:00.0000000', '2026-03-09T00:00:00.0000000')).toEqual({ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' })
    // and maps to exactly that bare date for the install board
    expect(busyDatesFromSlots([allDayBusy('2026-11-01T04:00:00', '2026-11-02T05:00:00')], '2026-10-30', '2026-11-03')).toEqual(['2026-11-01'])
    expect(busyDatesFromSlots([allDayBusy('2026-03-08T05:00:00', '2026-03-09T04:00:00')], '2026-03-06', '2026-03-10')).toEqual(['2026-03-08'])
  })

  it('free/busy reads an all-day event as the org-local day', async () => {
    mockFetch((c) =>
      c.url.includes('/me/calendars?') ? { json: { value: [{ id: 'c1', isDefaultCalendar: true }] } } : { json: { value: [{ start: { dateTime: '2026-11-01T04:00:00.0000000' }, end: { dateTime: '2026-11-02T05:00:00.0000000' }, showAs: 'free', isAllDay: true }, { start: { dateTime: '2026-11-01T04:00:00.0000000' }, end: { dateTime: '2026-11-02T05:00:00.0000000' }, showAs: 'oof', isAllDay: true }] } }
    )
    const busy = await microsoftClient('tok').getFreeBusy(new Date('2026-10-31T00:00:00Z'), new Date('2026-11-03T00:00:00Z'))
    expect(busy).toEqual([{ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' }])
  })

  it('Graph busy times map to the right business-timezone day across the November change', () => {
    const slot = { start: graphUtcToIso('2026-11-02T04:30:00.0000000'), end: graphUtcToIso('2026-11-02T05:30:00.0000000') }
    // 04:30Z on Nov 2 is 23:30 EST on Nov 1 (offset -5 after the change)
    expect(busyDatesFromSlots([slot], '2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02'])
    const mar = { start: graphUtcToIso('2026-03-09T03:30:00.0000000'), end: graphUtcToIso('2026-03-09T04:30:00.0000000') }
    // 03:30Z Mar 9 is 23:30 EDT on Mar 8
    expect(busyDatesFromSlots([mar], '2026-03-08', '2026-03-10')).toEqual(['2026-03-08', '2026-03-09'])
  })

  it('invites are dropped when the org says to notify nobody', () => {
    const e = { summary: 's', start: { dateTime: '2026-11-02T15:00:00Z' }, end: { dateTime: '2026-11-02T16:00:00Z' }, attendees: [{ email: 'x@y.co' }] }
    expect(toGraphEvent(e, 'none').attendees).toBeUndefined()
    expect(toGraphEvent(e, 'all').attendees).toEqual([{ emailAddress: { address: 'x@y.co' }, type: 'required' }])
  })

  it('RSVP words match Google', () => {
    expect(['accepted', 'declined', 'tentativelyAccepted', 'notResponded', undefined].map(rsvpOf)).toEqual(['accepted', 'declined', 'tentative', 'needsAction', 'needsAction'])
  })
})

describe('Microsoft free/busy never reports free when not shared', () => {
  it('maps errors and unreadable answers to not_shared / error, busy to slots', () => {
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule({ scheduleId: 'a@x.co', error: { responseCode: 'ErrorMailRecipientNotFound' } }))).toBe('not_shared')
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule({ scheduleId: 'a@x.co', error: { responseCode: 'ErrorAccessDenied' } }))).toBe('not_shared')
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule({ scheduleId: 'a@x.co' }))).toBe('not_shared')
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule({ scheduleId: 'a@x.co', error: { responseCode: 'ErrorServerBusy' } }))).toBe('error')
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule(undefined))).toBe('error')
    expect(resolveSubShareStatus('a@x.co', resultFromSchedule({ availabilityView: '0022' }))).toBe('error')
    const ok = resultFromSchedule({ availabilityView: '0220', scheduleItems: [{ status: 'busy', start: { dateTime: '2026-11-02T14:00:00.0000000' }, end: { dateTime: '2026-11-02T15:00:00.0000000' } }, { status: 'free', start: { dateTime: '2026-11-02T16:00:00.0000000' }, end: { dateTime: '2026-11-02T17:00:00.0000000' } }] })
    expect(ok).toEqual({ busy: [{ start: '2026-11-02T14:00:00.000Z', end: '2026-11-02T15:00:00.000Z' }] })
    expect(resolveSubShareStatus('a@x.co', ok)).toBe('ok')
  })

  it('getFreeBusyForCalendars asks getSchedule in UTC and keeps one result per id', async () => {
    const calls = mockFetch(() => ({ json: { value: [{ scheduleId: 'a@x.co', availabilityView: '00', scheduleItems: [] }, { scheduleId: 'B@x.co', error: { responseCode: 'ErrorMailRecipientNotFound' } }] } }))
    const r = await microsoftClient('tok').getFreeBusyForCalendars(new Date('2026-11-02T05:00:00Z'), new Date('2026-11-03T05:00:00Z'), ['a@x.co', 'b@x.co', 'c@x.co', 'a@x.co'])
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/me/calendar/getSchedule')
    expect(calls[0].body.startTime).toEqual({ dateTime: '2026-11-02T05:00:00', timeZone: 'UTC' })
    expect(r['a@x.co']).toEqual({ busy: [] })
    expect(r['b@x.co']).toEqual({ error: 'notFound' })
    expect(r['c@x.co']).toEqual({ error: 'no_response' })
  })
})

type Row = Record<string, any>
function fakeAdmin(tables: Record<string, Row[]>) {
  const log: { table: string; op: string; payload?: any; filters: Record<string, any> }[] = []
  const from = (table: string) => {
    const filters: Record<string, any> = {}
    let op = 'select'
    let payload: any
    const exec = () => {
      log.push({ table, op, payload, filters: { ...filters } })
      const rows = (tables[table] ??= [])
      const match = rows.filter((r) => Object.entries(filters).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)))
      if (op === 'update') match.forEach((r) => Object.assign(r, payload))
      if (op === 'delete') tables[table] = rows.filter((r) => !match.includes(r))
      if (op === 'upsert') {
        const i = rows.findIndex((r) => r.user_id === payload.user_id)
        if (i >= 0) rows[i] = { ...rows[i], ...payload }
        else rows.push({ ...payload })
      }
      return { data: op === 'select' ? match : null, error: null }
    }
    const b: any = {
      select: () => b,
      update: (p: any) => ((op = 'update'), (payload = p), b),
      delete: () => ((op = 'delete'), b),
      upsert: (p: any) => ((op = 'upsert'), (payload = p), exec()),
      eq: (k: string, v: any) => ((filters[k] = v), b),
      in: (k: string, v: any[]) => ((filters[k] = v), b),
      maybeSingle: async () => ({ data: exec().data?.[0] ?? null, error: null }),
      then: (res: any) => res(exec()),
    }
    return b
  }
  return { admin: { from } as any, tables, log }
}

describe('Microsoft token storage, refresh and org scoping', () => {
  const key = () => integrationSecretKey('microsoft-calendar')!
  const seal = (u: string, access: string, refresh: string, expires: Date) => ({
    user_id: u,
    org_id: 'org1',
    access_token_sealed: sealWithKey(key(), access, `${u}:access`),
    refresh_token_sealed: sealWithKey(key(), refresh, `${u}:refresh`),
    expires_at: expires.toISOString(),
  })

  it('uses a fresh token as is, and the client is Microsoft', async () => {
    const { admin } = fakeAdmin({ user_microsoft_tokens: [seal('u1', 'acc', 'ref', new Date(Date.now() + 3600_000))] })
    const c = await getCalendarClient(admin, 'u1')
    expect(c?.provider).toBe('microsoft')
    expect(c?.accessToken).toBe('acc')
  })

  it('refreshes an expiring token and stores the ROTATED refresh token, sealed', async () => {
    const { admin, tables } = fakeAdmin({ user_microsoft_tokens: [seal('u1', 'old', 'ref1', new Date(Date.now() + 60_000))] })
    const calls = mockFetch(() => ({ json: { access_token: 'new', refresh_token: 'ref2', expires_in: 3600, scope: 's' } }))
    const c = await getCalendarClient(admin, 'u1')
    expect(c?.accessToken).toBe('new')
    expect(calls[0].body.toString()).toContain('grant_type=refresh_token')
    const row = tables.user_microsoft_tokens[0]
    expect(openWithKey(key(), row.refresh_token_sealed, 'u1:refresh')).toBe('ref2')
    expect(openWithKey(key(), row.access_token_sealed, 'u1:access')).toBe('new')
    expect(JSON.stringify(row)).not.toContain('ref2')
  })

  it('a failed refresh of an expired token yields no client (never a dead token)', async () => {
    const { admin } = fakeAdmin({ user_microsoft_tokens: [seal('u1', 'old', 'ref1', new Date(Date.now() - 60_000))] })
    mockFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }))
    expect(await getCalendarClient(admin, 'u1')).toBeNull()
  })

  it('a sealed value copied to another user does not open', async () => {
    const stolen = seal('u1', 'acc', 'ref', new Date(Date.now() + 3600_000))
    const { admin } = fakeAdmin({ user_microsoft_tokens: [{ ...stolen, user_id: 'u2' }] })
    expect(await getCalendarClient(admin, 'u2')).toBeNull()
  })

  it('Outlook off (env unset) = Google path only, no Microsoft query', async () => {
    delete process.env.MICROSOFT_CLIENT_ID
    const { admin, log } = fakeAdmin({ user_google_tokens: [{ user_id: 'u1', access_token: 'g', refresh_token: 'r', expires_at: new Date(Date.now() + 3600_000).toISOString() }] })
    const c = await getCalendarClient(admin, 'u1')
    expect(c?.provider).toBe('google')
    expect(log.some((l) => l.table === 'user_microsoft_tokens')).toBe(false)
  })

  it('connected-user lookup only reads the ids it is given, across both providers', async () => {
    const { admin } = fakeAdmin({ user_google_tokens: [{ user_id: 'a' }, { user_id: 'z' }], user_microsoft_tokens: [{ user_id: 'b' }, { user_id: 'y' }] })
    expect(Array.from(await calendarConnectedUserIds(admin, ['a', 'b', 'c'])).sort()).toEqual(['a', 'b'])
  })

  it('connecting Outlook stores the caller\'s own org and clears Google (one provider)', async () => {
    const { admin, tables } = fakeAdmin({ user_google_tokens: [{ user_id: 'u1' }, { user_id: 'u2' }] })
    mockFetch((c) => (c.url.includes('/token') ? { json: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } } : { json: { mail: 'me@co.com' } }))
    expect(await saveMicrosoftConnection(admin, 'code', 'verifier', 'u1', 'org9')).toBe(true)
    expect(tables.user_microsoft_tokens[0]).toMatchObject({ user_id: 'u1', org_id: 'org9', account_email: 'me@co.com' })
    expect(tables.user_google_tokens).toEqual([{ user_id: 'u2' }])
    expect(JSON.stringify(tables.user_microsoft_tokens[0])).not.toMatch(/"a"|"r"/)
  })
})

describe('OAuth state', () => {
  const insertOnly = () => ({ from: () => ({ insert: async () => ({ error: null }), delete: () => ({ lt: async () => ({}) }) }) }) as any

  it('a tampered or wrong-purpose ticket is refused before any database work', async () => {
    const t = await issueOAuthState(insertOnly(), { userId: 'u', orgId: 'o', returnHost: 'crm.example.com', purpose: 'microsoft' })
    expect(t).not.toBeNull()
    const [body, mac] = t!.state.split('.')
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString())
    forged.u = 'someone-else'
    const forgedState = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`
    const never = { from: () => { throw new Error('db touched') } } as any
    expect(await acceptOAuthCallback(never, forgedState, 'c', Date.now(), { purpose: 'microsoft' })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(await acceptOAuthCallback(never, `${body}.${mac.slice(0, -2)}AA`, 'c', Date.now(), { purpose: 'microsoft' })).toEqual({ ok: false, reason: 'bad_signature' })
    // a Google callback can't redeem an Outlook ticket (and vice versa)
    expect(await acceptOAuthCallback(never, t!.state, 'c', Date.now(), { purpose: 'google' })).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('PKCE verifier is derived server-side from the nonce and matches its challenge', () => {
    const a = pkceFor('nonce-1')!
    expect(pkceFor('nonce-1')).toEqual(a)
    expect(pkceFor('nonce-2')!.verifier).not.toBe(a.verifier)
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})


describe('Outlook guest mail: sendUpdates none never mails guests', () => {
  const guestsCall = (c: Call) => c.method === 'GET' && c.url.includes('$select=attendees')
  it('update with none and guests on the event writes nothing and says so', async () => {
    const calls = mockFetch((c) => (guestsCall(c) ? { json: { attendees: [{ emailAddress: { address: 'sub@x.co' } }] } } : { json: { id: 'e1' } }))
    const r = await microsoftClient('t').updateEvent('e1', { summary: 'x' }, 'primary', 'none')
    expect(r.skipped).toBe('guests_would_be_notified')
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })
  it('update with none and no guests goes ahead; patch guests are never sent on none', async () => {
    const calls = mockFetch((c) => (guestsCall(c) ? { json: { attendees: [] } } : { json: { id: 'e1', subject: 'x' } }))
    const r = await microsoftClient('t').updateEvent('e1', { summary: 'x' }, 'primary', 'none')
    expect(r.skipped).toBeUndefined()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1)
    const again = mockFetch(() => ({ json: { id: 'e1' } }))
    const r2 = await microsoftClient('t').updateEvent('e1', { attendees: [{ email: 'a@b.co' }] }, 'primary', 'none')
    expect(r2.skipped).toBe('guests_would_be_notified')
    expect(again.some((c) => c.method === 'PATCH')).toBe(false)
  })
  it('update with no preference passes the guests through (adjuster / attendee changes land)', async () => {
    const calls = mockFetch(() => ({ json: { id: 'e1' } }))
    await microsoftClient('t').updateEvent('e1', { attendees: [{ email: 'a@b.co' }, { email: 'c@d.co' }] })
    expect(calls[0].body.attendees).toEqual([{ emailAddress: { address: 'a@b.co' }, type: 'required' }, { emailAddress: { address: 'c@d.co' }, type: 'required' }])
  })
  it('delete with none and guests is skipped; without guests it deletes; omitted = plain delete as before', async () => {
    let guests = true
    const calls = mockFetch((c) => (guestsCall(c) ? { json: { attendees: guests ? [{}] : [] } } : { status: 204 }))
    expect(await microsoftClient('t').deleteEvent('e1', 'primary', 'none')).toEqual({ skipped: 'guests_would_be_notified' })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    guests = false
    await microsoftClient('t').deleteEvent('e1', 'primary', 'none')
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    const plain = mockFetch(() => ({ status: 204 }))
    await microsoftClient('t').deleteEvent('e1')
    expect(plain.map((c) => c.method)).toEqual(['DELETE'])
  })
  it('a 400 or 404 from either provider on a stored id is stale; other errors are not', () => {
    expect(isStaleEventIdError(new CalendarApiError('x', 400))).toBe(true)
    expect(isStaleEventIdError(new CalendarApiError('x', 404))).toBe(true)
    expect(isStaleEventIdError(new CalendarApiError('x', 500))).toBe(false)
    expect(isStaleEventIdError(new Error('x'))).toBe(false)
  })
})

describe('Outlook refresh without a new refresh token keeps the old one', () => {
  it('stores the old refresh token again', async () => {
    const key = integrationSecretKey('microsoft-calendar')!
    const { admin, tables } = fakeAdmin({
      user_microsoft_tokens: [{ user_id: 'u1', org_id: 'o', access_token_sealed: sealWithKey(key, 'old', 'u1:access'), refresh_token_sealed: sealWithKey(key, 'ref1', 'u1:refresh'), expires_at: new Date(Date.now() + 60_000).toISOString() }],
    })
    mockFetch(() => ({ json: { access_token: 'new', expires_in: 3600 } }))
    expect((await getCalendarClient(admin, 'u1'))?.accessToken).toBe('new')
    expect(openWithKey(key, tables.user_microsoft_tokens[0].refresh_token_sealed, 'u1:refresh')).toBe('ref1')
  })
})

describe('disconnectCalendar', () => {
  const failing = (failTable: string) => {
    const touched: string[] = []
    const admin = { from: (t: string) => ({ delete: () => ({ eq: async () => (touched.push(t), { error: t === failTable ? { message: `${t} boom` } : null }) }) }) } as any
    return { admin, touched }
  }
  it('a Microsoft table failure never fails a Google disconnect', async () => {
    const { admin } = failing('user_microsoft_tokens')
    expect(await disconnectCalendar(admin, 'u1')).toBeNull()
    expect(await disconnectCalendar(admin, 'u1', 'google')).toBeNull()
    expect(await disconnectCalendar(admin, 'u1', 'microsoft')).toBe('user_microsoft_tokens boom')
  })
  it('Outlook off: user_microsoft_tokens is never touched', async () => {
    delete process.env.MICROSOFT_CLIENT_ID
    const { admin, touched } = failing('user_microsoft_tokens')
    expect(await disconnectCalendar(admin, 'u1')).toBeNull()
    expect(touched).toEqual(['user_google_tokens'])
  })
  it('a Google failure is still reported', async () => {
    const { admin } = failing('user_google_tokens')
    expect(await disconnectCalendar(admin, 'u1', 'google')).toBe('user_google_tokens boom')
  })
})
