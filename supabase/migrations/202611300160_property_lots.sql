-- Development + lot on a property (a home builder's lots: one customer = the builder, many properties = its lots).
-- Two nullable text columns, no table: a development is only a name (nothing to attach to it, nothing to join), and one
-- more table would be one more thing to keep in step. Every picker is built from the distinct values already on file.
-- Additive / nullable only. NOT applied by the builder: apply by hand BEFORE the code that reads it (the code's property
-- select names these columns; until then the Properties card reads as "not ready").
-- Rollback: DROP INDEX public.properties_org_community_idx; ALTER TABLE public.properties DROP COLUMN community, DROP COLUMN lot;

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS community text NULL CHECK (community IS NULL OR char_length(community) <= 120);
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS lot text NULL CHECK (lot IS NULL OR char_length(lot) <= 40);

-- The Development board and its filters read "this company's lots in a development".
CREATE INDEX IF NOT EXISTS properties_org_community_idx ON public.properties (org_id, community) WHERE community IS NOT NULL;

COMMIT;
