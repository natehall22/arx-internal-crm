-- Price sheet: more units, size options on a price-book item, a price list per customer / quote.
-- ADDITIVE ONLY and nullable: nothing existing changes. Roofing (one price list, no options) reads and writes exactly as before.
--
-- 1. Units: package, pallet, lot, home, load, service join the DB enum `unit` (pricebook_items.unit). visit / month / hour
--    come from migration 202611100090 and are not touched here. ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe to re-run;
--    the new values are not USED in this file (Postgres forbids that in the same transaction).
-- 2. Size options: `pricebook_items.price_options` = jsonb array of { key, label, price } (e.g. Mowing: Small lot / Medium
--    lot / Large lot). NULL = no options = the item's own unit_price. A jsonb array on the item, not a child table: an item
--    has a handful of options that are always read with it, never queried on their own, and a child table would add a join,
--    an RLS policy and one more place to forget the company filter on every item read. (lib/price-list.ts is the one reader.)
--    `pricebook_items.description` = plain-words conditions shown on the quote line ("only when more than one load").
-- 3. Price lists reuse `pricebooks` (a company may already keep several). A customer's list and a quote's list are nullable
--    pointers; NULL = follow the default list. The composite foreign key keeps a list inside its own company.
-- 4. A quote line keeps the option that was chosen and that option's list price at the time (unit_price may differ when the
--    rep typed a different price, as today).

ALTER TYPE unit ADD VALUE IF NOT EXISTS 'package';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'pallet';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'lot';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'home';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'load';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'service';

ALTER TABLE public.pricebook_items
  ADD COLUMN IF NOT EXISTS price_options jsonb NULL,
  ADD COLUMN IF NOT EXISTS description text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricebook_items_price_options_is_array') THEN
    ALTER TABLE public.pricebook_items
      ADD CONSTRAINT pricebook_items_price_options_is_array
      CHECK (price_options IS NULL OR (jsonb_typeof(price_options) = 'array' AND jsonb_array_length(price_options) <= 12));
  END IF;
END $$;

-- A list is identified by (id, org_id) so a customer / quote can only point at a list of its own company.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pricebooks_id_org_id_key') THEN
    ALTER TABLE public.pricebooks ADD CONSTRAINT pricebooks_id_org_id_key UNIQUE (id, org_id);
  END IF;
END $$;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pricebook_id uuid NULL;
ALTER TABLE public.proposals ADD COLUMN IF NOT EXISTS pricebook_id uuid NULL;

-- ON DELETE SET NULL (pricebook_id): deleting a list clears the pointer only (never the company column). Postgres 15+.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_pricebook_same_org_fkey') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_pricebook_same_org_fkey
      FOREIGN KEY (pricebook_id, org_id) REFERENCES public.pricebooks (id, org_id) ON DELETE SET NULL (pricebook_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_pricebook_same_org_fkey') THEN
    ALTER TABLE public.proposals
      ADD CONSTRAINT proposals_pricebook_same_org_fkey
      FOREIGN KEY (pricebook_id, org_id) REFERENCES public.pricebooks (id, org_id) ON DELETE SET NULL (pricebook_id);
  END IF;
END $$;

ALTER TABLE public.proposal_line_items
  ADD COLUMN IF NOT EXISTS price_option_key text NULL,
  ADD COLUMN IF NOT EXISTS price_option_name text NULL,
  ADD COLUMN IF NOT EXISTS price_option_price numeric(10, 2) NULL;

COMMENT ON COLUMN public.pricebook_items.price_options IS 'Named size options [{key,label,price}] — lib/price-list.ts. NULL = no options.';
COMMENT ON COLUMN public.pricebook_items.description IS 'Conditions in plain words, copied onto the quote line (e.g. "only when more than one load").';
COMMENT ON COLUMN public.customers.pricebook_id IS 'This customer''s price list (e.g. Builder). NULL = the company''s default list.';
COMMENT ON COLUMN public.proposals.pricebook_id IS 'The price list this quote was built from. NULL = the customer''s list, else the default.';
COMMENT ON COLUMN public.proposal_line_items.price_option_key IS 'Key of that option on the price-book item (lets a re-save keep the choice).';
COMMENT ON COLUMN public.proposal_line_items.price_option_name IS 'The size option the rep tapped, when the item has options.';
COMMENT ON COLUMN public.proposal_line_items.price_option_price IS 'That option''s list price when quoted; unit_price differs if the rep overrode it.';
