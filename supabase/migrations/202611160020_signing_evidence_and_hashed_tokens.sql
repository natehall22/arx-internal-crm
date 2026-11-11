-- Signing safety (PR0). Additive only; the app is live.
--  * who signed: the customer's browser (user agent) is kept next to the IP, on contracts and change orders.
-- Apply BEFORE the code that writes these columns (deploy order: 202611160010, 202611160020, 202611160030, then the code).
ALTER TABLE order_form_contracts ADD COLUMN IF NOT EXISTS customer_user_agent TEXT;
ALTER TABLE job_change_orders
  ADD COLUMN IF NOT EXISTS customer_ip TEXT,
  ADD COLUMN IF NOT EXISTS customer_user_agent TEXT;
-- A change order waiting for its customer always has an expiry (NOT VALID: checked for new writes; nothing outstanding lacks one).
ALTER TABLE job_change_orders DROP CONSTRAINT IF EXISTS job_change_orders_pending_has_expiry;
ALTER TABLE job_change_orders
  ADD CONSTRAINT job_change_orders_pending_has_expiry CHECK (status <> 'pending_customer' OR token_expires_at IS NOT NULL) NOT VALID;

--  * signing links: a NEW token is stored as its SHA-256 (signing_token_hash, what a link is looked up by) plus an encrypted
--    copy (signing_token_enc, so "Copy link" still works). The plaintext columns stay for links already sent and are left
--    empty for new rows; the contracts' column loses its NOT NULL / random default so a new row has no plaintext token.
ALTER TABLE order_form_contracts
  ADD COLUMN IF NOT EXISTS signing_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS signing_token_enc TEXT;
ALTER TABLE order_form_contracts ALTER COLUMN signing_token DROP NOT NULL;
ALTER TABLE order_form_contracts ALTER COLUMN signing_token DROP DEFAULT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_form_contracts_signing_token_hash
  ON order_form_contracts(signing_token_hash) WHERE signing_token_hash IS NOT NULL;

ALTER TABLE job_change_orders
  ADD COLUMN IF NOT EXISTS signing_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS signing_token_enc TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_change_orders_signing_token_hash
  ON job_change_orders(signing_token_hash) WHERE signing_token_hash IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
