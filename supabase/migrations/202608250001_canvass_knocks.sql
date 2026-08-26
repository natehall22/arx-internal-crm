-- Bug: re-knocking a PRE-EXISTING pin does not count toward the rep's door/pin count
-- (dashboard "doors knocked", the sisu leaderboard, setter ramp gating, and Heat
-- door-count badges).
--
-- Root cause: every one of those counters treats "a lead row exists with created_at in
-- the window" as a proxy for "a knock happened." That's true the first time a pin is
-- dropped (leads INSERT, fresh created_at) but false every time after: when a rep
-- re-visits an existing pin and logs a new disposition, app/api/canvass/lead/route.ts
-- takes the UPDATE branch (leadId is set) and never touches created_at. The event is
-- saved (canvass_disposition changes) but is invisible to every created_at-windowed count.
--
-- Fix: an append-only knock-event log. One row per knock (new pin OR re-knock of an
-- existing pin), written by the same route that already handles both paths. Counting
-- queries move from "leads created in window" to "knocks logged in window."
--
-- user_id deliberately has NO foreign key — same rationale as leads.pin_attributed_user_id
-- (migration 106_canvass_pin_attributed_user.sql): a rep who leaves the company must not
-- lose historical knock credit, and pin_attributed_user_id itself can already reference a
-- user no longer in `users`. source/disposition are copied from the lead at knock time so
-- each consumer (dashboard, setter ramp, Heat) can keep applying its own existing source
-- filter without a join back to leads.
-- (lead_id, user_id, created_at) unique: makes the backfill INSERT idempotent (ON
-- CONFLICT DO NOTHING below) despite this project's documented migration-history drift
-- requiring occasional manual reconciliation/replay. user_id is part of the key so two
-- DIFFERENT reps knocking the same pin are never collapsed into one row — same reason
-- log_canvass_knock()'s same-visit dedupe is scoped to (lead, rep): a second rep at the
-- same door is a real, separate door, and only a rep's own duplicate submit should be
-- suppressed.
CREATE TABLE IF NOT EXISTS canvass_knocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  disposition TEXT,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canvass_knocks_lead_created_unique UNIQUE (lead_id, user_id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_canvass_knocks_org_user_created
  ON canvass_knocks (org_id, user_id, created_at);

-- Several readers (app/api/admin/sisu/accountability/route.ts,
-- lib/sync-setter-ramp-core.ts) filter by org_id + a created_at
-- range with NO user_id predicate (they bucket by attributed user in application code
-- afterward) — the (org_id, user_id, created_at) index above can only use its org_id
-- prefix for those, falling back to a scan of the rest. This lets Postgres seek directly
-- on the date range instead.
CREATE INDEX IF NOT EXISTS idx_canvass_knocks_org_created
  ON canvass_knocks (org_id, created_at);

CREATE INDEX IF NOT EXISTS idx_canvass_knocks_lead
  ON canvass_knocks (lead_id);

-- Locked down like comp_plan_versions: RLS on with no policies. Every reader is a
-- SECURITY DEFINER function (below / dashboard RPCs) or the service-role client
-- (app/api/canvass/lead/route.ts, lib/sync-setter-ramp-core.ts) — neither needs a policy,
-- and no client-side surface reads this table directly today.
ALTER TABLE canvass_knocks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE canvass_knocks IS
  'Append-only door-knock event log. One row per knock (new pin or re-knock of an existing pin). Source of truth for the dashboard "doors knocked" stat, the sisu leaderboard, setter ramp gating, and Heat door-count badges — replaces counting leads.created_at, which missed every re-knock of a pre-existing pin.';
COMMENT ON COLUMN canvass_knocks.user_id IS
  'Rep credited for this specific knock — the lead''s attribution (pin_attributed_user_id, falling back to owner_user_id) at the moment of this knock. No FK: must survive the rep leaving the company, same as leads.pin_attributed_user_id.';

-- Backfill: one knock row per existing lead that already counts as a door under the
-- current (pre-fix) rules, dated at the lead's created_at. This is the broadest filter
-- in use across all consumers (dashboard's migration 130 OR-disposition clause is a
-- superset of the plain source-list filter setter ramp and the sisu leaderboard use)
-- so every consumer's own narrower filter,
-- applied at read time, reproduces exactly what it counts today. Historical re-knocks
-- were never recorded anywhere, so this intentionally preserves current-state parity
-- (1 backfilled knock per pin) rather than inventing knock history that doesn't exist —
-- only knocks logged from here forward get real re-knock credit.
INSERT INTO canvass_knocks (org_id, lead_id, user_id, disposition, source, created_at)
SELECT
  l.org_id,
  l.id,
  COALESCE(l.pin_attributed_user_id, l.owner_user_id),
  l.canvass_disposition,
  l.source,
  l.created_at
FROM leads l
WHERE COALESCE(l.pin_attributed_user_id, l.owner_user_id) IS NOT NULL
  AND (
    lower(trim(COALESCE(l.source, ''))) IN ('door_to_door', 'canvass', 'door_knock', 'csv_import')
    OR (
      l.canvass_disposition IS NOT NULL
      AND lower(trim(COALESCE(l.source, ''))) NOT IN ('web', 'inbound')
    )
  )
ON CONFLICT (lead_id, user_id, created_at) DO NOTHING;

-- The only write path for a single live knock (bulk CSV import writes canvass_knocks
-- directly — see app/api/canvass/import/route.ts — since a bulk upload has no knock
-- time of its own; import time IS the correct event time there).
--
-- p_created_at is the KNOCK time, not the sync time: canvass is offline-first (Zustand +
-- IndexedDB queue — app/(canvass-app)/canvass/lib/offlineStore.ts), so a rep can knock
-- 400 doors Thu/Fri with no signal and sync Sat/Mon. If this function stamped every row
-- with its own INSERT time (the old behavior), that whole batch would land on the sync
-- date instead of the knock date — shifting doors into the wrong setter-ramp pay period,
-- which can both falsely disqualify a rep who did the work and falsely qualify one whose
-- doors got shifted into a week they didn't earn. The route threads knocked_at from the
-- client (app/api/canvass/lead/route.ts, sourced from the canvass app's own
-- new Date().toISOString() capture at save time — see app/(canvass-app)/canvass/page.tsx).
--
-- Device clocks aren't trusted blindly: a wrong or spoofed clock could otherwise backdate
-- a knock into an already-closed/paid period, or forward-date one into a future period —
-- either mints a door nobody can audit against real activity. Anything more than 5
-- minutes in the future, or more than 30 days in the past (further back than a realistic
-- offline stretch), falls back to the server's clock instead of trusting the client value.
--
-- Same-visit dedupe compares against the KNOCK's own effective time, not against "now" or
-- against the single most-recent row — an offline batch can sync out of chronological
-- order (5 real knocks over 3 days, synced together in whatever order the queue drains),
-- so "is there already a logged knock within SAME_VISIT_WINDOW of THIS knock's time"
-- (checked both directions) is the only version of the check that survives reordering.
-- Within the window, no value comparison is needed or wanted: a rep who drops a pin with
-- no disposition selected yet (LeadModal allows this) and fills one in minutes later goes
-- NULL -> 'not_home' — a value change, but still the same visit. Outside the window, ANY
-- save counts as a new knock even with an unchanged disposition ('not_home' again is the
-- single most common real re-knock outcome in door-to-door canvassing) — undercounting a
-- door is a support ticket; overcounting one is money already registered toward payroll
-- bonus qualification (setter_ramp_weekly_status.bonus_registered, once flipped true,
-- locks in the dollar fields for that week — see lib/sync-setter-ramp-core.ts). Erring
-- toward the cheaper failure mode (a slightly wider same-visit window) is deliberate.
--
-- A per-lead advisory lock serializes concurrent requests for the SAME lead (double-tap,
-- two devices, an offline batch syncing several knocks for one lead close together) so
-- the dedupe read and the insert can't race — without it, two concurrent callers could
-- both see no nearby knock and both insert, double-counting one visit. Returns the new
-- row's id, or NULL when this request was suppressed as the same visit.
CREATE OR REPLACE FUNCTION public.log_canvass_knock(
  p_org_id UUID,
  p_lead_id UUID,
  p_user_id UUID,
  p_disposition TEXT,
  p_source TEXT,
  p_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_now CONSTANT TIMESTAMPTZ := NOW();
  v_effective_created_at TIMESTAMPTZ;
  SAME_VISIT_WINDOW CONSTANT INTERVAL := INTERVAL '30 minutes';
  MAX_FUTURE_SKEW CONSTANT INTERVAL := INTERVAL '5 minutes';
  MAX_PAST_AGE CONSTANT INTERVAL := INTERVAL '30 days';
BEGIN
  v_effective_created_at := COALESCE(p_created_at, v_now);
  IF v_effective_created_at > v_now + MAX_FUTURE_SKEW OR v_effective_created_at < v_now - MAX_PAST_AGE THEN
    v_effective_created_at := v_now;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_lead_id::text));

  -- Scoped to (lead, rep) rather than the lead alone: the case this dedupe exists to
  -- collapse is ONE rep submitting the same visit twice (double-tap, retry, an offline
  -- entry replaying after it already synced). A DIFFERENT rep knocking the same pin is a
  -- real, separate door and must still be recorded — keying on lead_id alone silently
  -- swallowed it and cost that rep the credit.
  IF EXISTS (
    SELECT 1 FROM canvass_knocks
    WHERE lead_id = p_lead_id
      AND user_id = p_user_id
      AND created_at BETWEEN v_effective_created_at - SAME_VISIT_WINDOW
                          AND v_effective_created_at + SAME_VISIT_WINDOW
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO canvass_knocks (org_id, lead_id, user_id, disposition, source, created_at)
  VALUES (p_org_id, p_lead_id, p_user_id, p_disposition, p_source, v_effective_created_at)
  ON CONFLICT (lead_id, user_id, created_at) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Same rationale as amend_comp_plan_version (202608190001_comp_plan_versions.sql):
-- Postgres grants EXECUTE on a new function to PUBLIC by default, which in Supabase
-- includes anon and authenticated. Without this, any authenticated rep could call the
-- RPC directly from the client SDK and mint arbitrary knocks (inflating their own or
-- someone else's door count / bonus qualification) instead of only through the
-- service-role-authenticated canvass API route.
REVOKE ALL ON FUNCTION public.log_canvass_knock(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_canvass_knock(UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
