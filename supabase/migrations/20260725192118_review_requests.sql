-- Review-request flow: one review-request record per completed production job.
-- Additive only; touches no existing table. Tracked link + attribution + send audit.
-- Applied to prod via MCP apply_migration (version 20260725192118) on 2026-07-25;
-- this file mirrors it for version control / migration-history reconcile.
CREATE TABLE IF NOT EXISTS review_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  production_job_id  uuid NOT NULL REFERENCES production_jobs(id) ON DELETE CASCADE,
  customer_id        uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- Attribution: the job's salesperson/closer, even when Ops sends the request.
  salesperson_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Unguessable token backing the /api/r/<token> tracked redirect.
  token              text NOT NULL,
  -- 'manual' = rep/ops sent via SMS deep link or Google Voice copy. Room for 'email'/'auto' later.
  channel            text NOT NULL DEFAULT 'manual',
  -- Who actually sent it (rep OR ops backstop). NULL until sent.
  sent_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at            timestamptz,
  clicked_at         timestamptz,
  click_count        integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One record per job => built-in dedupe / upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_job   ON review_requests(production_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_token ON review_requests(token);
CREATE INDEX        IF NOT EXISTS idx_review_requests_org         ON review_requests(org_id);
CREATE INDEX        IF NOT EXISTS idx_review_requests_salesperson ON review_requests(org_id, salesperson_id);
CREATE INDEX        IF NOT EXISTS idx_review_requests_sent        ON review_requests(org_id, sent_at);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view review_requests in their org" ON review_requests;
CREATE POLICY "Users can view review_requests in their org" ON review_requests
  FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can manage review_requests in their org" ON review_requests;
CREATE POLICY "Users can manage review_requests in their org" ON review_requests
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE review_requests IS 'Post-job Google review requests: one per production job, tracked link + send/click audit. Attribution = salesperson_id; sent_by records who actually sent (rep or ops backstop).';
