-- Durable, atomic idempotency boundary for public Instant Estimate unlock
-- delivery. raw_payload is audit data only and cannot safely dedupe two
-- simultaneous HTTP unlock requests.
CREATE TABLE IF NOT EXISTS public_estimate_unlock_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  delivery_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'sent', 'failed')),
  attempt_id UUID NOT NULL DEFAULT gen_random_uuid(),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT public_estimate_unlock_deliveries_lead_key_unique UNIQUE (lead_id, delivery_key)
);

CREATE INDEX IF NOT EXISTS idx_public_estimate_unlock_deliveries_pending
  ON public_estimate_unlock_deliveries (state, claimed_at)
  WHERE state = 'claimed';

ALTER TABLE public_estimate_unlock_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public_estimate_unlock_deliveries FROM anon, authenticated;

-- A delivery can be retried after an explicit failure. A stale claim may be
-- reclaimed after five minutes, preventing a crashed request from blocking
-- delivery forever while preventing normal parallel retries from duplicating it.
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

-- Prevent historical Instant Estimate retries from replaying alerts after this
-- table is introduced. Manual and reveal keys stay distinct so a later paid
-- promotion still gets its own activity, owner notification, and ops email.
--
-- CRM columns + homeowner_estimate_email_mode win over reveal-shaped raw_payload.
-- Partial promotions (reveal raw_payload but Manual Measure source/notes) must NOT
-- be pre-marked reveal-sent — keep in sync with classifyPublicEstimateUnlockBackfillPath
-- in lib/public-estimate-lead.ts.
INSERT INTO public_estimate_unlock_deliveries (
  org_id,
  lead_id,
  delivery_key,
  state,
  sent_at
)
SELECT l.org_id, l.id, keys.delivery_key, 'sent', NOW()
FROM leads l
CROSS JOIN LATERAL (
  SELECT 'lead-activity:manual' AS delivery_key
  WHERE (
    l.source = 'Website Instant Estimate — Manual Measure'
    OR l.notes ILIKE '%NOT routed to inside sales%'
    OR l.notes ILIKE '%DO NOT quote%'
    OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
    OR (
      (
        COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
        OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
      )
      AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
    )
  )
  UNION ALL
  SELECT 'ops-email:manual'
  WHERE (
    l.source = 'Website Instant Estimate — Manual Measure'
    OR l.notes ILIKE '%NOT routed to inside sales%'
    OR l.notes ILIKE '%DO NOT quote%'
    OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
    OR (
      (
        COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
        OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
      )
      AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
    )
  )
  UNION ALL
  SELECT 'lead-activity:reveal'
  WHERE NOT (
    l.source = 'Website Instant Estimate — Manual Measure'
    OR l.notes ILIKE '%NOT routed to inside sales%'
    OR l.notes ILIKE '%DO NOT quote%'
    OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
    OR (
      (
        COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
        OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
      )
      AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
    )
  )
  AND (
    l.raw_payload->>'homeowner_estimate_email_mode' = 'reveal'
    OR (
      l.source = 'Website Instant Estimate'
      AND (
        l.notes ILIKE '%CALL IMMEDIATELY%'
        OR l.owner_user_id IS NOT NULL
      )
    )
    OR (
      l.raw_payload->>'homeowner_estimate_email_mode' IS NULL
      AND (
        COALESCE(l.raw_payload->>'pricing_mode', '') IN ('auto', 'fallback_unreliable', 'fallback_complex')
        OR (
          l.raw_payload->>'estimate_mode' = 'auto'
          AND (
            COALESCE((l.raw_payload->>'price_low')::numeric, 0) > 0
            OR COALESCE((l.raw_payload->>'price_high')::numeric, 0) > 0
          )
        )
      )
    )
  )
  UNION ALL
  SELECT 'ops-email:reveal'
  WHERE NOT (
    l.source = 'Website Instant Estimate — Manual Measure'
    OR l.notes ILIKE '%NOT routed to inside sales%'
    OR l.notes ILIKE '%DO NOT quote%'
    OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
    OR (
      (
        COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
        OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
      )
      AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
    )
  )
  AND (
    l.raw_payload->>'homeowner_estimate_email_mode' = 'reveal'
    OR (
      l.source = 'Website Instant Estimate'
      AND (
        l.notes ILIKE '%CALL IMMEDIATELY%'
        OR l.owner_user_id IS NOT NULL
      )
    )
    OR (
      l.raw_payload->>'homeowner_estimate_email_mode' IS NULL
      AND (
        COALESCE(l.raw_payload->>'pricing_mode', '') IN ('auto', 'fallback_unreliable', 'fallback_complex')
        OR (
          l.raw_payload->>'estimate_mode' = 'auto'
          AND (
            COALESCE((l.raw_payload->>'price_low')::numeric, 0) > 0
            OR COALESCE((l.raw_payload->>'price_high')::numeric, 0) > 0
          )
        )
      )
    )
  )
  UNION ALL
  SELECT 'owner-notification:reveal'
  WHERE NOT (
    l.source = 'Website Instant Estimate — Manual Measure'
    OR l.notes ILIKE '%NOT routed to inside sales%'
    OR l.notes ILIKE '%DO NOT quote%'
    OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
    OR (
      (
        COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
        OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
      )
      AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
    )
  )
  AND (
    l.raw_payload->>'homeowner_estimate_email_mode' = 'reveal'
    OR (
      l.source = 'Website Instant Estimate'
      AND (
        l.notes ILIKE '%CALL IMMEDIATELY%'
        OR l.owner_user_id IS NOT NULL
      )
    )
    OR (
      l.raw_payload->>'homeowner_estimate_email_mode' IS NULL
      AND (
        COALESCE(l.raw_payload->>'pricing_mode', '') IN ('auto', 'fallback_unreliable', 'fallback_complex')
        OR (
          l.raw_payload->>'estimate_mode' = 'auto'
          AND (
            COALESCE((l.raw_payload->>'price_low')::numeric, 0) > 0
            OR COALESCE((l.raw_payload->>'price_high')::numeric, 0) > 0
          )
        )
      )
    )
  )
) keys
WHERE l.external_lead_id LIKE 'public-estimate:%'
ON CONFLICT (lead_id, delivery_key) DO NOTHING;

-- Backfill homeowner estimate delivery keys so a prior manual acknowledgement
-- does not block a later paid reveal email, and reveal sends are not replayed.
-- Never insert reveal homeowner key when silent-manual CRM signals are present.
INSERT INTO public_estimate_unlock_deliveries (
  org_id,
  lead_id,
  delivery_key,
  state,
  sent_at
)
SELECT
  l.org_id,
  l.id,
  CASE
    WHEN (
      l.source = 'Website Instant Estimate — Manual Measure'
      OR l.notes ILIKE '%NOT routed to inside sales%'
      OR l.notes ILIKE '%DO NOT quote%'
      OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
      OR (
        (
          COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
          OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
        )
        AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
      )
    )
      THEN 'homeowner-estimate:manual:' || lower(trim(l.email))
    WHEN l.raw_payload->>'homeowner_estimate_email_mode' = 'reveal'
      OR l.raw_payload->>'homeowner_estimate_email_mode' IS NULL
      THEN 'homeowner-estimate:reveal:' || lower(trim(l.email))
  END,
  'sent',
  NOW()
FROM leads l
WHERE l.external_lead_id LIKE 'public-estimate:%'
  AND l.email IS NOT NULL
  AND trim(l.email) <> ''
  AND l.raw_payload ? 'homeowner_estimate_emailed_at'
  AND CASE
    WHEN (
      l.source = 'Website Instant Estimate — Manual Measure'
      OR l.notes ILIKE '%NOT routed to inside sales%'
      OR l.notes ILIKE '%DO NOT quote%'
      OR l.raw_payload->>'homeowner_estimate_email_mode' = 'manual'
      OR (
        (
          COALESCE(l.raw_payload->>'pricing_mode', '') = 'silent_manual'
          OR COALESCE(l.raw_payload->>'estimate_mode', '') = 'manual_design'
        )
        AND l.raw_payload->>'homeowner_estimate_email_mode' IS DISTINCT FROM 'reveal'
      )
    )
      THEN 'homeowner-estimate:manual:' || lower(trim(l.email))
    WHEN l.raw_payload->>'homeowner_estimate_email_mode' = 'reveal'
      OR l.raw_payload->>'homeowner_estimate_email_mode' IS NULL
      THEN 'homeowner-estimate:reveal:' || lower(trim(l.email))
  END IS NOT NULL
ON CONFLICT (lead_id, delivery_key) DO NOTHING;
