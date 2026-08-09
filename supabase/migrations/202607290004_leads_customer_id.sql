-- leads.customer_id has been referenced by app code since commit fd47235 ("Customer at
-- contract only; customer lead trace", Mar 2026) -- app/api/contracts/sign/route.ts stamps it
-- when a customer is ensured at contract sign, app/customers/[id]/page.tsx reads it to resolve
-- a customer's leads, and app/api/canvass/lead/route.ts, app/api/inspections/status/route.ts,
-- app/api/proposals/[id]/route.ts, app/api/proposals/[id]/create-project/route.ts, and
-- app/api/admin/repair-contract-project/route.ts all read or write it too -- but the column was
-- never actually migrated. In production this makes every leads query/update that touches it
-- error (PGRST204/42703 "column leads.customer_id does not exist"); most call sites swallow the
-- error in a try/catch and silently no-op, and app/customers/[id]/page.tsx's Leads tab silently
-- renders empty.
--
-- Adding it now, mirroring the customer_id FK pattern already used on projects and opportunities
-- (both added in 011_opportunities_projects.sql): nullable, additive, ON DELETE SET NULL.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_customer_id ON leads(customer_id);

-- Backfill leads that already reached contract sign (their project or opportunity carries a
-- customer) but never got customer_id stamped because the column didn't exist yet.
UPDATE leads l
SET customer_id = p.customer_id
FROM projects p
WHERE p.lead_id = l.id
  AND p.customer_id IS NOT NULL
  AND l.customer_id IS NULL;

UPDATE leads l
SET customer_id = o.customer_id
FROM opportunities o
WHERE o.lead_id = l.id
  AND o.customer_id IS NOT NULL
  AND l.customer_id IS NULL;
