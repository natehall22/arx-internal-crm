-- Link every opportunity that has no customer to one (Customer File needs a customer to key on).
-- Same rule as lib/customers.ts findExistingCustomer: real email, then last-10 phone; otherwise create ONE customer
-- per distinct person (email, else phone, else name+address, else the opportunity itself). Customer fields come from the
-- opportunity's lead. Nothing is deleted; leads.customer_id is NOT written (canvass reads it as "existing customer");
-- no QuickBooks event is queued (QuickBooks only hears about a customer at signing).
-- Run AFTER migration 202610270010. Needs data_fix_backups (created by 2026-10-24_end_plans_for_inactive_users.sql).

-- To PREVIEW only: run everything below with the final COMMIT replaced by ROLLBACK (the result sets are the preview).
BEGIN;

-- PREVIEW 1/2: what will happen, in numbers.
CREATE TEMP TABLE _orphan_plan ON COMMIT DROP AS
WITH o AS (
  SELECT op.id AS opp_id, op.org_id, op.status, op.lead_id, op.address_text AS opp_addr,
         l.homeowner_name, l.phone, l.email, l.address_text AS lead_addr,
         right(regexp_replace(coalesce(l.phone,''),'\D','','g'),10) AS p10,
         CASE WHEN lower(btrim(coalesce(l.email,''))) IN ('','none@none.com','noemail@noemail.com','noemail@example.com') THEN NULL ELSE lower(btrim(l.email)) END AS em
  FROM opportunities op LEFT JOIN leads l ON l.id = op.lead_id AND l.org_id = op.org_id
  WHERE op.customer_id IS NULL
)
SELECT o.*,
  (SELECT c.id FROM customers c WHERE c.org_id = o.org_id AND o.em IS NOT NULL AND c.email_lower = o.em ORDER BY c.created_at LIMIT 1) AS by_email,
  (SELECT c.id FROM customers c WHERE c.org_id = o.org_id AND length(o.p10) = 10 AND right(c.phone_normalized, 10) = o.p10 ORDER BY c.created_at LIMIT 1) AS by_phone,
  coalesce(o.em, CASE WHEN length(o.p10) = 10 THEN o.p10 END,
           nullif(lower(btrim(coalesce(o.homeowner_name,'') || '|' || coalesce(o.lead_addr, o.opp_addr, ''))), '|'),
           o.opp_id::text) AS person_key
FROM o;

SELECT count(*) AS orphans,
       count(*) FILTER (WHERE by_email IS NOT NULL) AS link_existing_by_email,
       count(*) FILTER (WHERE by_email IS NULL AND by_phone IS NOT NULL) AS link_existing_by_phone,
       count(*) FILTER (WHERE by_email IS NULL AND by_phone IS NULL) AS need_new_customer,
       count(DISTINCT person_key) FILTER (WHERE by_email IS NULL AND by_phone IS NULL) AS distinct_new_customers,
       count(*) FILTER (WHERE lead_id IS NULL) AS no_lead_at_all
FROM _orphan_plan;

-- PREVIEW 2/2: the orphans that will join an EXISTING customer (look these over; phone is the weaker match).
SELECT p.opp_id, p.status, p.homeowner_name AS lead_name, c.name AS existing_customer, c.phone AS existing_phone,
       CASE WHEN p.by_email IS NOT NULL THEN 'email' ELSE 'phone' END AS matched_on
FROM _orphan_plan p JOIN customers c ON c.id = coalesce(p.by_email, p.by_phone)
ORDER BY matched_on, c.name;

-- Backup: every opportunity this changes (customer_id was NULL) …
INSERT INTO data_fix_backups (fix, table_name, row_data)
SELECT '2026-10-27_link_orphan_opportunities', 'opportunities', jsonb_build_object('id', opp_id, 'customer_id', NULL)
FROM _orphan_plan;

-- … then new customers, one per distinct person.
CREATE TEMP TABLE _new_customers ON COMMIT DROP AS
SELECT DISTINCT ON (person_key) person_key, gen_random_uuid() AS customer_id, org_id,
       coalesce(nullif(btrim(homeowner_name),''), nullif(btrim(split_part(coalesce(lead_addr, opp_addr, ''), ',', 1)),''),
                CASE WHEN length(p10) >= 4 THEN 'Customer (' || right(p10, 4) || ')' END, 'Customer') AS name,
       phone, em AS email, coalesce(lead_addr, opp_addr) AS address_text
FROM _orphan_plan
WHERE by_email IS NULL AND by_phone IS NULL
ORDER BY person_key, opp_id;

INSERT INTO customers (id, org_id, name, phone, email, address_text)
SELECT customer_id, org_id, name, phone, email, address_text FROM _new_customers;
INSERT INTO data_fix_backups (fix, table_name, row_data)
SELECT '2026-10-27_link_orphan_opportunities', 'customers_created', jsonb_build_object('id', customer_id) FROM _new_customers;

UPDATE opportunities op
   SET customer_id = coalesce(p.by_email, p.by_phone, n.customer_id)
  FROM _orphan_plan p LEFT JOIN _new_customers n ON n.person_key = p.person_key AND p.by_email IS NULL AND p.by_phone IS NULL
 WHERE op.id = p.opp_id AND op.customer_id IS NULL;
COMMIT;

-- Verify: SELECT count(*) FROM opportunities WHERE customer_id IS NULL;   -- expect 0
-- Rollback (exact):
--   UPDATE opportunities SET customer_id = NULL WHERE id IN (SELECT (row_data->>'id')::uuid FROM data_fix_backups WHERE fix = '2026-10-27_link_orphan_opportunities' AND table_name = 'opportunities');
--   DELETE FROM customers WHERE id IN (SELECT (row_data->>'id')::uuid FROM data_fix_backups WHERE fix = '2026-10-27_link_orphan_opportunities' AND table_name = 'customers_created');
