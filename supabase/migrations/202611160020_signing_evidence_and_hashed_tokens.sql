-- Signing safety (PR0). Additive only; the app is live.
--  * who signed: the customer's browser (user agent) is kept next to the IP, on contracts and change orders.
-- Apply BEFORE the code that writes these columns.
ALTER TABLE order_form_contracts ADD COLUMN IF NOT EXISTS customer_user_agent TEXT;
