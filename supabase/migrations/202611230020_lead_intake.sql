-- Lead intake: website-form service choices, the service a lead asked for, per-source routing override, the
-- take-turns pointer, and one "lead waiting" notification per lead. ADDITIVE ONLY; safe before or after the code
-- (the webhook drops unknown columns on insert and falls back when the function is missing).

SET LOCAL lock_timeout = '5s';  -- never queue behind a long query and block the live tables

ALTER TABLE leads         ADD COLUMN IF NOT EXISTS service_requested text;
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS service_options jsonb;   -- ["Weekly lawn care", ...] the form's dropdown
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS routing jsonb;           -- optional override of orgs.settings.leadIntake routing
-- A source whose token sits in a public web page: its posts always get the honeypot, required fields and the shared
-- DB-backed rate limit (portal_take_attempt, migration 202611120060). Server-to-server sources leave it false.
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS public_form boolean NOT NULL DEFAULT false;
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS form_daily_cap integer CHECK (form_daily_cap IS NULL OR form_daily_cap BETWEEN 1 AND 100000);

-- Whose turn is next, per company and scope ('org:rotate', 'source:<id>:rotate', '<base>:service:<name>').
CREATE TABLE IF NOT EXISTS lead_routing_pointers (
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  scope         text NOT NULL,
  last_user_id  uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, scope)
);
ALTER TABLE lead_routing_pointers ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

-- The next ACTIVE person of this company after the last one handed a lead. The pointer row is locked for the whole call,
-- so two leads arriving together are serialized and never get the same turn. NULL when nobody in the list is eligible
-- (the pointer is then left alone and the caller uses its fallback owner).
CREATE OR REPLACE FUNCTION lead_routing_next(p_org_id uuid, p_scope text, p_user_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  eligible uuid[];
  last_id  uuid;
  pos      int;
  picked   uuid;
BEGIN
  SELECT coalesce(array_agg(l.id ORDER BY l.ord), '{}') INTO eligible
  FROM unnest(p_user_ids) WITH ORDINALITY AS l(id, ord)
  JOIN users u ON u.id = l.id AND u.org_id = p_org_id AND u.active = true;
  IF coalesce(array_length(eligible, 1), 0) = 0 THEN RETURN NULL; END IF;

  INSERT INTO lead_routing_pointers (org_id, scope) VALUES (p_org_id, p_scope) ON CONFLICT DO NOTHING;
  SELECT last_user_id INTO last_id FROM lead_routing_pointers WHERE org_id = p_org_id AND scope = p_scope FOR UPDATE;

  -- Continue after the last person handed a lead. If they are no longer eligible (inactive / removed from the list),
  -- continue from the next ELIGIBLE person after their place in the full list, not from the first.
  pos := array_position(eligible, last_id);
  IF pos IS NOT NULL THEN
    picked := eligible[(pos % array_length(eligible, 1)) + 1];
  ELSE
    pos := array_position(p_user_ids, last_id);   -- NULL when never used or removed from the list: start at the first
    IF pos IS NULL THEN
      picked := eligible[1];
    ELSE
      SELECT l.id INTO picked FROM unnest(p_user_ids) WITH ORDINALITY AS l(id, ord)
      WHERE l.ord > pos AND l.id = ANY(eligible) ORDER BY l.ord LIMIT 1;
      IF picked IS NULL THEN picked := eligible[1]; END IF;
    END IF;
  END IF;
  UPDATE lead_routing_pointers SET last_user_id = picked, updated_at = now() WHERE org_id = p_org_id AND scope = p_scope;
  RETURN picked;
END;
$$;
REVOKE ALL ON FUNCTION lead_routing_next(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lead_routing_next(uuid, text, uuid[]) TO service_role;

-- One "lead waiting" bell per lead AND owner: a repeat or a racing cron run hits this and is skipped, and a lead handed to
-- a new owner can remind the new owner once.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_lead_waiting_once
  ON notifications ((data->>'lead_id'), recipient_user_id)
  WHERE type = 'lead_waiting';
