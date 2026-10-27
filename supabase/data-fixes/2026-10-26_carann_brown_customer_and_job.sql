-- Carann Brown (contract 087dfaa0-0bc6-4c67-9885-70cd36297c78, gutters only, cash, signed 2026-10-23):
--   (a) her opportunity/project/lead hang off the TEST customer b502bb02 ("testing", phone 2222222222) because both used a filler phone;
--   (b) the signing never created her production job (job_type 'gutters' failed the CHECK; fixed in code + migration 202610290130).
--
-- ORDER:  1) apply migration 202610290130 (or skip: the script falls back to job_type 'mixed')
--         2) run this file as-is: it PREVIEWS, then does the customer fix inside a transaction that ENDS IN ROLLBACK
--         3) when the preview looks right, change the final ROLLBACK to COMMIT and run it again
--         4) create the job through the app's own code path (NOT SQL):  npx tsx --env-file=.env.local scripts/fix-contract-job.ts 087dfaa0-0bc6-4c67-9885-70cd36297c78 --apply
--            (without --apply it only prints what it would do). Run it AFTER step 3 so the job gets her real customer.
--
-- The OTHER opportunity on the test customer (8ecb0f87, "testing tester", Kannapolis, natehall22@gmail.com) is a test deal: left alone.

-- ------------------------------------------------------------------ PREVIEW (read-only)
SELECT 'contract' AS what, c.id::text, c.customer_name, c.customer_email, c.customer_phone, c.project_address, c.status, c.customer_signed_at::text AS signed
  FROM order_form_contracts c WHERE c.id = '087dfaa0-0bc6-4c67-9885-70cd36297c78';

SELECT 'rows now on the test customer' AS what, 'opportunity' AS kind, o.id::text, l.homeowner_name, l.address_text, o.status::text,
       CASE WHEN o.id = '0b1ef2ac-9740-4551-bd84-aef8409d5fff' THEN 'REPOINT (Carann, real)' ELSE 'LEAVE (test deal)' END AS action
  FROM opportunities o LEFT JOIN leads l ON l.id = o.lead_id WHERE o.customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b'
UNION ALL
SELECT 'rows now on the test customer', 'project', p.id::text, NULL, p.address_text, p.status::text,
       CASE WHEN p.id = 'b2385a2c-89f6-4f16-abb9-b93e02fbff76' THEN 'REPOINT' ELSE 'LEAVE' END
  FROM projects p WHERE p.customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b'
UNION ALL
SELECT 'rows now on the test customer', 'lead', l.id::text, l.homeowner_name, l.address_text, NULL,
       CASE WHEN l.id = 'a4a3cd8a-d8f3-418d-a6de-04fec68ea34a' THEN 'REPOINT' ELSE 'LEAVE' END
  FROM leads l WHERE l.customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b';

SELECT 'would reuse an existing real Carann customer?' AS what, id::text, name, phone, email, address_text
  FROM customers
 WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND email_lower = 'carannb@gmail.com' AND id <> 'b502bb02-080f-497d-9c7b-0299629fe40b';

SELECT 'production job for her project (expect none)' AS what, count(*)::text FROM production_jobs WHERE project_id = 'b2385a2c-89f6-4f16-abb9-b93e02fbff76';

-- ------------------------------------------------------------------ APPLY (transaction; ends in ROLLBACK until you change it)
BEGIN;

-- Reuse a real customer with her email if one exists, else create her from the signed contract. phone is left NULL on purpose:
-- 2222222222 is a filler number, and a filler phone is exactly what merged her into the test customer.
WITH existing AS (
  SELECT id FROM customers
   WHERE org_id = '9089d4ad-f46c-405b-9798-6751d45a7051' AND email_lower = 'carannb@gmail.com' AND id <> 'b502bb02-080f-497d-9c7b-0299629fe40b'
   ORDER BY created_at, id LIMIT 1
), created AS (
  INSERT INTO customers (org_id, name, email, address_text)
  SELECT c.org_id, c.customer_name, lower(c.customer_email), c.project_address
    FROM order_form_contracts c
   WHERE c.id = '087dfaa0-0bc6-4c67-9885-70cd36297c78' AND NOT EXISTS (SELECT 1 FROM existing)
  RETURNING id
), target AS (
  SELECT id FROM existing UNION ALL SELECT id FROM created
)
SELECT set_config('arx.carann_customer', (SELECT id::text FROM target LIMIT 1), true);

UPDATE opportunities SET customer_id = current_setting('arx.carann_customer')::uuid
 WHERE id = '0b1ef2ac-9740-4551-bd84-aef8409d5fff' AND customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b';
UPDATE projects SET customer_id = current_setting('arx.carann_customer')::uuid
 WHERE id = 'b2385a2c-89f6-4f16-abb9-b93e02fbff76' AND customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b';
UPDATE leads SET customer_id = current_setting('arx.carann_customer')::uuid
 WHERE id = 'a4a3cd8a-d8f3-418d-a6de-04fec68ea34a' AND customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b';

-- Verify inside the transaction: exactly her three rows moved, the test deal and the test customer are untouched.
SELECT 'after' AS what,
  (SELECT customer_id::text FROM opportunities WHERE id = '0b1ef2ac-9740-4551-bd84-aef8409d5fff') AS carann_opp_customer,
  (SELECT count(*) FROM opportunities WHERE customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b') AS still_on_test_customer_opps,
  (SELECT name FROM customers WHERE id = current_setting('arx.carann_customer')::uuid) AS new_customer_name;

ROLLBACK;   -- change to COMMIT to keep it

-- ------------------------------------------------------------------ UNDO (after a COMMIT; only if wrong)
-- Put her three rows back on the test customer and remove the customer this run created (if nothing else references it):
--   UPDATE opportunities SET customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b' WHERE id = '0b1ef2ac-9740-4551-bd84-aef8409d5fff';
--   UPDATE projects      SET customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b' WHERE id = 'b2385a2c-89f6-4f16-abb9-b93e02fbff76';
--   UPDATE leads         SET customer_id = 'b502bb02-080f-497d-9c7b-0299629fe40b' WHERE id = 'a4a3cd8a-d8f3-418d-a6de-04fec68ea34a';
--   DELETE FROM customers WHERE id = '<the new customer id from the "after" row>' AND NOT EXISTS (SELECT 1 FROM opportunities WHERE customer_id = customers.id);
