-- One-off visits (2026-11-17): a single visit for a customer's property (one mow, one grading touch-up) is a service plan that
-- makes exactly one visit. This flag says so explicitly, so lists, the Recurring tag, the dashboard plan counts and the customer
-- portal's plan list can tell it from a regular plan that happens to end the same day it starts.
-- one_off_key: the client-made key of the request that created it, so a double tap or a retried request returns the same visit
-- instead of making a second one (unique per company when set).
-- Additive only: one new column with a default; existing rows are false. Apply BEFORE the code that reads it.
-- Rollback: the column is harmless to leave in place; older code never reads it.
ALTER TABLE public.service_plans ADD COLUMN IF NOT EXISTS one_off boolean NOT NULL DEFAULT false;
ALTER TABLE public.service_plans ADD COLUMN IF NOT EXISTS one_off_key text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_plans_one_off_key_uq ON public.service_plans (org_id, one_off_key) WHERE one_off_key IS NOT NULL;
