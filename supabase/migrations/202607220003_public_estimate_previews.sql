-- Shared preview snapshots for public website instant estimate funnel.
-- Replaces in-memory Map so preview + unlock work across Vercel serverless instances.
-- Service role only — no RLS policies (same pattern as user_incentive_goals_history).

CREATE TABLE IF NOT EXISTS public_estimate_previews (
  jti TEXT PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  squares_mid NUMERIC NOT NULL,
  squares_low NUMERIC NOT NULL,
  squares_high NUMERIC NOT NULL,
  waste_percent NUMERIC NOT NULL,
  facet_count INTEGER NOT NULL,
  measure_source TEXT NOT NULL,
  requires_manual_measure BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_estimate_previews_expires_at
  ON public_estimate_previews (expires_at);

ALTER TABLE public_estimate_previews ENABLE ROW LEVEL SECURITY;
