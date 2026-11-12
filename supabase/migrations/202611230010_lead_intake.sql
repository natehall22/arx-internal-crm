-- Lead intake: website-form service choices, the service a lead asked for, per-source routing override, the
-- take-turns pointer, and one "lead waiting" notification per lead. ADDITIVE ONLY; safe before or after the code
-- (the webhook drops unknown columns on insert and falls back when the function is missing).

ALTER TABLE leads         ADD COLUMN IF NOT EXISTS service_requested text;
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS service_options jsonb;   -- ["Weekly lawn care", ...] the form's dropdown
ALTER TABLE lead_sources  ADD COLUMN IF NOT EXISTS routing jsonb;           -- optional override of orgs.settings.leadIntake routing

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

  pos := coalesce(array_position(eligible, last_id), 0);
  picked := eligible[(pos % array_length(eligible, 1)) + 1];
  UPDATE lead_routing_pointers SET last_user_id = picked, updated_at = now() WHERE org_id = p_org_id AND scope = p_scope;
  RETURN picked;
END;
$$;
REVOKE ALL ON FUNCTION lead_routing_next(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION lead_routing_next(uuid, text, uuid[]) TO service_role;

-- One "lead waiting" bell per lead, ever: a repeat or a racing cron run hits this and is skipped.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_lead_waiting_once
  ON notifications ((data->>'lead_id'))
  WHERE type = 'lead_waiting';
