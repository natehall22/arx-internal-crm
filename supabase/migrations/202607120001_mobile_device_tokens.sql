-- Mobile device tokens for APNs push (ARX Sales iOS)
-- Migration: 202607120001_mobile_device_tokens.sql
-- Apply via Supabase SQL editor or MCP apply_migration (not supabase db push).

CREATE TABLE IF NOT EXISTS mobile_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  device_token text NOT NULL,
  platform text NOT NULL DEFAULT 'ios',
  environment text NOT NULL DEFAULT 'production', -- 'sandbox' | 'production'
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_token)
);

CREATE INDEX IF NOT EXISTS idx_mobile_device_tokens_user_id
  ON mobile_device_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_mobile_device_tokens_org_id
  ON mobile_device_tokens(org_id);

ALTER TABLE mobile_device_tokens ENABLE ROW LEVEL SECURITY;

-- Service-role API routes bypass RLS; policies allow authenticated users to read their own rows
-- if a client ever queries directly.
CREATE POLICY "mobile_device_tokens_select_own"
  ON mobile_device_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "mobile_device_tokens_insert_own"
  ON mobile_device_tokens FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "mobile_device_tokens_update_own"
  ON mobile_device_tokens FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "mobile_device_tokens_delete_own"
  ON mobile_device_tokens FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE mobile_device_tokens IS
  'APNs device tokens for ARX Sales iOS; upserted via /api/mobile/push-token';
