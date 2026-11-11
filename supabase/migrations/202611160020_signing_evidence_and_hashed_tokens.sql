-- Signing safety (PR0). Additive only; the app is live.
--  * who signed: the customer's browser (user agent) is kept next to the IP, on contracts and change orders.
-- Apply BEFORE the code that writes these columns.
ALTER TABLE order_form_contracts ADD COLUMN IF NOT EXISTS customer_user_agent TEXT;
ALTER TABLE job_change_orders
  ADD COLUMN IF NOT EXISTS customer_ip TEXT,
  ADD COLUMN IF NOT EXISTS customer_user_agent TEXT;
-- A change order waiting for its customer always has an expiry (NOT VALID: checked for new writes; nothing outstanding lacks one).
ALTER TABLE job_change_orders DROP CONSTRAINT IF EXISTS job_change_orders_pending_has_expiry;
ALTER TABLE job_change_orders
  ADD CONSTRAINT job_change_orders_pending_has_expiry CHECK (status <> 'pending_customer' OR token_expires_at IS NOT NULL) NOT VALID;
