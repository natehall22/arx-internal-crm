CREATE TABLE IF NOT EXISTS employee_comp_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  agreement_key TEXT NOT NULL CHECK (agreement_key IN ('field_marketer', 'senior_field_marketer', 'closer')),
  agreement_version TEXT NOT NULL,
  agreement_snapshot JSONB NOT NULL,
  agreement_content_hash TEXT NOT NULL,
  request_key UUID NOT NULL,
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'manager_signed' CHECK (status IN ('manager_signed', 'sending', 'sent', 'rep_signed', 'declined', 'voided', 'delivery_failed')),
  manager_user_id UUID NOT NULL REFERENCES users(id),
  manager_signed_name TEXT NOT NULL,
  manager_signed_email TEXT,
  manager_signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manager_signed_ip TEXT,
  manager_signed_user_agent TEXT,
  signing_token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  receipt_token_hash TEXT,
  receipt_expires_at TIMESTAMPTZ,
  sent_to_email TEXT,
  sent_at TIMESTAMPTZ,
  delivery_error TEXT,
  send_attempt_id UUID,
  send_claimed_at TIMESTAMPTZ,
  rep_signed_name TEXT,
  rep_signed_at TIMESTAMPTZ,
  rep_signed_ip TEXT,
  rep_signed_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_comp_agreements_token_hash ON employee_comp_agreements(signing_token_hash) WHERE signing_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_comp_agreements_receipt_hash ON employee_comp_agreements(receipt_token_hash) WHERE receipt_token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_comp_agreements_request_key ON employee_comp_agreements(org_id, manager_user_id, request_key);
CREATE INDEX IF NOT EXISTS idx_employee_comp_agreements_user ON employee_comp_agreements(org_id, user_id, created_at DESC);
ALTER TABLE employee_comp_agreements ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE employee_comp_agreements IS 'Immutable compensation agreement snapshots. Separate from payroll calculations and comp-plan assignments.';

CREATE TABLE IF NOT EXISTS employee_comp_agreement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES employee_comp_agreements(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('manager_signed', 'send_accepted', 'delivery_failed', 'resent', 'viewed', 'rep_signed', 'declined', 'voided')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  actor_email TEXT,
  event_ip TEXT,
  event_user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_employee_comp_agreement_events ON employee_comp_agreement_events(agreement_id, created_at);
ALTER TABLE employee_comp_agreement_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION prevent_employee_agreement_content_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.agreement_key IS DISTINCT FROM OLD.agreement_key
    OR NEW.agreement_version IS DISTINCT FROM OLD.agreement_version
    OR NEW.agreement_snapshot IS DISTINCT FROM OLD.agreement_snapshot
    OR NEW.agreement_content_hash IS DISTINCT FROM OLD.agreement_content_hash
    OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
    OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id
    OR NEW.manager_signed_name IS DISTINCT FROM OLD.manager_signed_name
    OR NEW.manager_signed_email IS DISTINCT FROM OLD.manager_signed_email
    OR NEW.manager_signed_at IS DISTINCT FROM OLD.manager_signed_at
    OR NEW.manager_signed_ip IS DISTINCT FROM OLD.manager_signed_ip
    OR NEW.manager_signed_user_agent IS DISTINCT FROM OLD.manager_signed_user_agent
  THEN RAISE EXCEPTION 'Signed agreement content and manager signature are immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employee_agreement_content_immutable ON employee_comp_agreements;
CREATE TRIGGER employee_agreement_content_immutable BEFORE UPDATE ON employee_comp_agreements FOR EACH ROW EXECUTE FUNCTION prevent_employee_agreement_content_mutation();

CREATE OR REPLACE FUNCTION enforce_employee_agreement_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.rep_signed_at IS NOT NULL AND (
    NEW.rep_signed_name IS DISTINCT FROM OLD.rep_signed_name OR
    NEW.rep_signed_at IS DISTINCT FROM OLD.rep_signed_at OR
    NEW.rep_signed_ip IS DISTINCT FROM OLD.rep_signed_ip OR
    NEW.rep_signed_user_agent IS DISTINCT FROM OLD.rep_signed_user_agent
  ) THEN RAISE EXCEPTION 'Rep signature is immutable'; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'manager_signed' AND NEW.status IN ('sending', 'voided')) OR
    (OLD.status = 'sending' AND NEW.status IN ('sent', 'delivery_failed')) OR
    (OLD.status = 'sent' AND NEW.status IN ('sending', 'rep_signed', 'declined', 'voided')) OR
    (OLD.status = 'delivery_failed' AND NEW.status IN ('sending', 'voided'))
  ) THEN RAISE EXCEPTION 'Invalid employee agreement status transition: % to %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employee_agreement_lifecycle ON employee_comp_agreements;
CREATE TRIGGER employee_agreement_lifecycle BEFORE UPDATE ON employee_comp_agreements FOR EACH ROW EXECUTE FUNCTION enforce_employee_agreement_lifecycle();

CREATE OR REPLACE FUNCTION prevent_employee_agreement_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Employee agreement audit events are append-only'; END; $$;
DROP TRIGGER IF EXISTS employee_agreement_events_append_only ON employee_comp_agreement_events;
CREATE TRIGGER employee_agreement_events_append_only BEFORE UPDATE OR DELETE ON employee_comp_agreement_events FOR EACH ROW EXECUTE FUNCTION prevent_employee_agreement_event_mutation();

CREATE OR REPLACE FUNCTION create_employee_comp_agreement(
  p_org_id UUID, p_user_id UUID, p_agreement_key TEXT, p_agreement_version TEXT,
  p_agreement_snapshot JSONB, p_content_hash TEXT, p_request_key UUID, p_effective_date DATE,
  p_manager_user_id UUID, p_manager_signed_name TEXT, p_manager_signed_email TEXT,
  p_manager_signed_ip TEXT, p_manager_signed_user_agent TEXT, p_sent_to_email TEXT
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  SELECT id INTO v_id FROM employee_comp_agreements
    WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key
      AND user_id = p_user_id AND agreement_key = p_agreement_key AND agreement_version = p_agreement_version
      AND agreement_snapshot = p_agreement_snapshot AND agreement_content_hash = p_content_hash
      AND effective_date = p_effective_date AND manager_signed_name = p_manager_signed_name
      AND manager_signed_email IS NOT DISTINCT FROM p_manager_signed_email AND sent_to_email = p_sent_to_email;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF EXISTS (SELECT 1 FROM employee_comp_agreements WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key)
    THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023'; END IF;
  INSERT INTO employee_comp_agreements (
    org_id, user_id, agreement_key, agreement_version, agreement_snapshot, agreement_content_hash,
    request_key, effective_date, manager_user_id, manager_signed_name, manager_signed_email,
    manager_signed_ip, manager_signed_user_agent, sent_to_email
  ) VALUES (
    p_org_id, p_user_id, p_agreement_key, p_agreement_version, p_agreement_snapshot, p_content_hash,
    p_request_key, p_effective_date, p_manager_user_id, p_manager_signed_name, p_manager_signed_email,
    p_manager_signed_ip, p_manager_signed_user_agent, p_sent_to_email
  ) RETURNING id INTO v_id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, event_ip, event_user_agent, metadata)
  VALUES (v_id, p_org_id, 'manager_signed', p_manager_user_id, p_manager_signed_name, p_manager_signed_email, p_manager_signed_ip, p_manager_signed_user_agent, jsonb_build_object('agreement_version', p_agreement_version, 'content_hash', p_content_hash));
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_id FROM employee_comp_agreements
    WHERE org_id = p_org_id AND manager_user_id = p_manager_user_id AND request_key = p_request_key
      AND user_id = p_user_id AND agreement_key = p_agreement_key AND agreement_version = p_agreement_version
      AND agreement_snapshot = p_agreement_snapshot AND agreement_content_hash = p_content_hash
      AND effective_date = p_effective_date AND manager_signed_name = p_manager_signed_name
      AND manager_signed_email IS NOT DISTINCT FROM p_manager_signed_email AND sent_to_email = p_sent_to_email;
  IF v_id IS NULL THEN RAISE EXCEPTION 'idempotency_key_payload_mismatch' USING ERRCODE = '22023'; END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION claim_employee_agreement_send(p_agreement_id UUID, p_attempt_id UUID, p_token_hash TEXT, p_token_expires_at TIMESTAMPTZ)
RETURNS employee_comp_agreements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id FOR UPDATE;
  IF v_row.id IS NULL OR NOT (v_row.status IN ('manager_signed', 'delivery_failed', 'sent') OR (v_row.status = 'sending' AND v_row.send_claimed_at < NOW() - INTERVAL '5 minutes')) THEN RETURN NULL; END IF;
  UPDATE employee_comp_agreements SET status = 'sending', send_attempt_id = p_attempt_id, send_claimed_at = NOW(),
    signing_token_hash = p_token_hash, token_expires_at = p_token_expires_at, delivery_error = NULL, updated_at = NOW()
    WHERE id = p_agreement_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_employee_agreement_send(
  p_agreement_id UUID, p_attempt_id UUID, p_event_type TEXT, p_actor_user_id UUID,
  p_actor_name TEXT, p_actor_email TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id AND status = 'sending' AND send_attempt_id = p_attempt_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN FALSE; END IF;
  IF p_event_type NOT IN ('send_accepted', 'resent') THEN RAISE EXCEPTION 'invalid_send_event'; END IF;
  UPDATE employee_comp_agreements SET status = 'sent', sent_at = NOW(), delivery_error = NULL, send_attempt_id = NULL, send_claimed_at = NULL, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata)
  VALUES (v_row.id, v_row.org_id, p_event_type, p_actor_user_id, p_actor_name, p_actor_email, jsonb_build_object('recipient', v_row.sent_to_email));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION fail_employee_agreement_send(
  p_agreement_id UUID, p_attempt_id UUID, p_actor_user_id UUID, p_actor_name TEXT, p_actor_email TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE id = p_agreement_id AND status = 'sending' AND send_attempt_id = p_attempt_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN FALSE; END IF;
  UPDATE employee_comp_agreements SET status = 'delivery_failed', delivery_error = 'Email could not be sent. Retry from the user profile.',
    signing_token_hash = NULL, token_expires_at = NULL, send_attempt_id = NULL, send_claimed_at = NULL, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_user_id, actor_name, actor_email, metadata)
  VALUES (v_row.id, v_row.org_id, 'delivery_failed', p_actor_user_id, p_actor_name, p_actor_email, jsonb_build_object('code', 'smtp_send_failed'));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION complete_employee_comp_agreement(
  p_signing_token_hash TEXT, p_signed_name TEXT, p_signed_ip TEXT, p_signed_user_agent TEXT,
  p_receipt_token_hash TEXT, p_receipt_expires_at TIMESTAMPTZ
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row employee_comp_agreements%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM employee_comp_agreements WHERE signing_token_hash = p_signing_token_hash AND status = 'sent' AND token_expires_at > NOW() FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  UPDATE employee_comp_agreements SET status = 'rep_signed', rep_signed_name = p_signed_name, rep_signed_at = NOW(), rep_signed_ip = p_signed_ip,
    rep_signed_user_agent = p_signed_user_agent, signing_token_hash = NULL, token_expires_at = NULL,
    receipt_token_hash = p_receipt_token_hash, receipt_expires_at = p_receipt_expires_at, updated_at = NOW() WHERE id = v_row.id;
  INSERT INTO employee_comp_agreement_events (agreement_id, org_id, event_type, actor_name, event_ip, event_user_agent, metadata)
  VALUES (v_row.id, v_row.org_id, 'rep_signed', p_signed_name, p_signed_ip, p_signed_user_agent, jsonb_build_object('content_hash', v_row.agreement_content_hash));
  RETURN v_row.id;
END;
$$;

REVOKE ALL ON FUNCTION create_employee_comp_agreement(UUID, UUID, TEXT, TEXT, JSONB, TEXT, UUID, DATE, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_employee_comp_agreement(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_employee_agreement_send(UUID, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_employee_agreement_send(UUID, UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_employee_agreement_send(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_employee_comp_agreement(UUID, UUID, TEXT, TEXT, JSONB, TEXT, UUID, DATE, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION complete_employee_comp_agreement(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION claim_employee_agreement_send(UUID, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_employee_agreement_send(UUID, UUID, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fail_employee_agreement_send(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
SELECT pg_notify('pgrst', 'reload schema');
