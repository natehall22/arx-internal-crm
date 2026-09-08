-- ============================================
-- SUB CALENDAR AVAILABILITY
--
-- Powers the ops install-schedule board's "is this sub already busy" check
-- (`GET /api/ops/install-schedule/availability`, `lib/sub-availability.ts`).
--
-- Permission model: subs do NOT do a Google OAuth flow. Each sub opens their
-- own Google Calendar sharing settings once and shares their calendar with an
-- ARX Google account at "See only free/busy (hide details)". Ops then reads
-- that free/busy using the REQUESTING ARX USER'S OWN existing Google token
-- (`user_google_tokens`, already populated by `getValidAccessToken` in
-- `lib/appointment-calendar-sync.ts`) — there is no new credential store here,
-- just two columns recording what the sub shared and whether we could last
-- read it.
--
-- Additive and nullable only — this system is live and in daily use. Both
-- columns default to NULL and change no existing behavior until the new
-- availability route starts reading/writing them.
-- ============================================

-- The calendar address the sub actually shared with ARX. Usually the same as
-- `scheduling_email` (the address already used for the install invite), but
-- not always — a sub can share a different calendar than the one they read
-- invites on — so this is its own column. Application code
-- (`resolveSubCalendarId` in `lib/sub-availability.ts`) falls back to
-- `scheduling_email` when this is null, so most subs never need it set.
ALTER TABLE sub_contractors
  ADD COLUMN IF NOT EXISTS scheduling_calendar_id TEXT;

-- Last time a free/busy read against this sub's calendar succeeded (Google
-- returned busy data with no per-calendar error). Lets ops tell a working
-- share apart from one that was never set up or got revoked, without having
-- to re-query Google just to check. NULL means "never successfully read."
ALTER TABLE sub_contractors
  ADD COLUMN IF NOT EXISTS calendar_share_verified_at TIMESTAMPTZ;
