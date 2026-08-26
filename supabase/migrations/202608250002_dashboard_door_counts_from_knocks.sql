-- Point the dashboard "doors knocked" RPCs (personal-stats, team-stats, sisu leaderboard,
-- goals-scorecard, sisu-weekly-doors, morning-update-metrics all call these — see
-- 130_dashboard_canvass_exclude_inbound_disposition_only.sql) at canvass_knocks instead of
-- leads.created_at, so a re-knock of a pre-existing pin counts. Signatures and return
-- shapes are unchanged — every caller keeps working with zero TS changes.
--
-- ACCEPTED RISK — do not "fix" without checking callers first (decision: Nathan, 2026-08-25).
-- These four functions are SECURITY DEFINER and carry pre-existing explicit EXECUTE grants
-- to `anon` and `authenticated`. CREATE OR REPLACE preserves ACLs, so they keep those
-- grants here while now reading canvass_knocks — a table whose own migration describes it
-- as service-role-only (RLS on, no policies). A security review will flag this; it was
-- raised and consciously accepted: the exposure predates this change (it already applied
-- to the lead-based counts), the data is door/lead aggregates rather than customer PII,
-- and org_id is an unguessable UUID. The obvious hardening (REVOKE ... FROM PUBLIC, anon,
-- authenticated) is deliberately NOT applied here because app/api/dashboard/team-stats/route.ts
-- reaches these via the anon key — revoking blindly would break the dashboard. If this is
-- ever tightened, migrate that caller to the service-role client FIRST.
--
-- Attribution note: previously these queries joined leads and used the lead's CURRENT
-- pin_attributed_user_id/owner_user_id, so a later ownership reassignment silently
-- reshuffled which rep a PAST period's door counted toward. canvass_knocks.user_id is
-- frozen at knock time (202608250001_canvass_knocks.sql), so historical counts for
-- already-closed periods no longer drift when a stale pin gets reassigned. Going forward
-- this is strictly more correct for a payroll-driving count.
--
-- Every canvass_knocks row is already door-eligible by construction — the write side
-- (app/api/canvass/lead/route.ts, app/api/canvass/import/route.ts, and this migration's
-- own backfill) only ever inserts one that qualifies. The 4 functions below re-check
-- eligibility anyway as defense-in-depth for a payroll-driving count — cheap insurance
-- against a future write path forgetting the gate — via this ONE shared predicate
-- instead of the same OR-clause copy-pasted 4 times (mirrors the TS-side single source
-- of truth, isCanvassDoorEligible in lib/canvass-lead-attribution.ts).
CREATE OR REPLACE FUNCTION public.canvass_knock_is_door_eligible(p_source TEXT, p_disposition TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    lower(trim(COALESCE(p_source, ''))) IN ('door_to_door', 'canvass', 'door_knock', 'csv_import')
    OR (
      p_disposition IS NOT NULL
      AND lower(trim(COALESCE(p_source, ''))) NOT IN ('web', 'inbound')
    );
$$;

CREATE OR REPLACE FUNCTION public.dashboard_count_door_leads_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM canvass_knocks k
  WHERE k.org_id = p_org_id
    AND k.created_at >= p_start
    AND k.created_at < p_end
    AND (
      cardinality(p_scope_user_ids) = 0
      OR k.user_id = ANY(p_scope_user_ids)
    )
    AND public.canvass_knock_is_door_eligible(k.source, k.disposition);
$$;

CREATE OR REPLACE FUNCTION public.dashboard_count_contact_leads_scoped(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_scope_user_ids uuid[],
  p_disposition_ids text[]
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::bigint
  FROM canvass_knocks k
  WHERE k.org_id = p_org_id
    AND k.created_at >= p_start
    AND k.created_at < p_end
    AND (
      cardinality(p_scope_user_ids) = 0
      OR k.user_id = ANY(p_scope_user_ids)
    )
    AND public.canvass_knock_is_door_eligible(k.source, k.disposition)
    AND cardinality(p_disposition_ids) > 0
    AND k.disposition = ANY(p_disposition_ids);
$$;

CREATE OR REPLACE FUNCTION public.dashboard_door_leads_by_owner(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[]
)
RETURNS TABLE (owner_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.user_id AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM canvass_knocks k
  WHERE k.org_id = p_org_id
    AND k.created_at >= p_start
    AND k.created_at < p_end
    AND k.user_id = ANY(p_member_ids)
    AND public.canvass_knock_is_door_eligible(k.source, k.disposition)
  GROUP BY 1;
$$;

CREATE OR REPLACE FUNCTION public.dashboard_contact_leads_by_owner(
  p_org_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_member_ids uuid[],
  p_disposition_ids text[]
)
RETURNS TABLE (owner_id uuid, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.user_id AS owner_id,
    COUNT(*)::bigint AS cnt
  FROM canvass_knocks k
  WHERE k.org_id = p_org_id
    AND k.created_at >= p_start
    AND k.created_at < p_end
    AND k.user_id = ANY(p_member_ids)
    AND public.canvass_knock_is_door_eligible(k.source, k.disposition)
    AND cardinality(p_disposition_ids) > 0
    AND k.disposition = ANY(p_disposition_ids)
  GROUP BY 1;
$$;
