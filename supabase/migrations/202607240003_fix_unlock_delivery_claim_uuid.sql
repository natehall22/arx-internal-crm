-- Patch for DBs that already applied 202607240002 with uuid_generate_v4().
-- Safe to run in Supabase SQL Editor: no data drops, idempotent function replace.

ALTER TABLE public_estimate_unlock_deliveries
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public_estimate_unlock_deliveries
  ALTER COLUMN attempt_id SET DEFAULT gen_random_uuid();

CREATE OR REPLACE FUNCTION claim_public_estimate_unlock_delivery(
  p_org_id UUID,
  p_lead_id UUID,
  p_delivery_key TEXT,
  p_claim_timeout_seconds INTEGER DEFAULT 300
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  INSERT INTO public_estimate_unlock_deliveries (org_id, lead_id, delivery_key)
  SELECT p_org_id, p_lead_id, p_delivery_key
  WHERE EXISTS (
    SELECT 1
    FROM leads
    WHERE id = p_lead_id
      AND org_id = p_org_id
  )
  ON CONFLICT (lead_id, delivery_key) DO UPDATE
    SET state = 'claimed',
        attempt_id = gen_random_uuid(),
        claimed_at = NOW(),
        failed_at = NULL,
        updated_at = NOW()
    WHERE public_estimate_unlock_deliveries.state = 'failed'
       OR (
         public_estimate_unlock_deliveries.state = 'claimed'
         AND public_estimate_unlock_deliveries.claimed_at < NOW() - make_interval(secs => GREATEST(p_claim_timeout_seconds, 1))
       )
  RETURNING attempt_id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION complete_public_estimate_unlock_delivery(
  p_lead_id UUID,
  p_delivery_key TEXT,
  p_attempt_id UUID
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public_estimate_unlock_deliveries
  SET state = 'sent', sent_at = NOW(), updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND delivery_key = p_delivery_key
    AND attempt_id = p_attempt_id
    AND state = 'claimed';
$$;

CREATE OR REPLACE FUNCTION fail_public_estimate_unlock_delivery(
  p_lead_id UUID,
  p_delivery_key TEXT,
  p_attempt_id UUID
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public_estimate_unlock_deliveries
  SET state = 'failed', failed_at = NOW(), updated_at = NOW()
  WHERE lead_id = p_lead_id
    AND delivery_key = p_delivery_key
    AND attempt_id = p_attempt_id
    AND state = 'claimed';
$$;

REVOKE ALL ON FUNCTION claim_public_estimate_unlock_delivery(UUID, UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION complete_public_estimate_unlock_delivery(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fail_public_estimate_unlock_delivery(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_public_estimate_unlock_delivery(UUID, UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION complete_public_estimate_unlock_delivery(UUID, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION fail_public_estimate_unlock_delivery(UUID, TEXT, UUID)
  TO service_role;
