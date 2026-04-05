/* Manager SPO on adders: optional toggle + percent for eligible management roles. */

ALTER TABLE pricebook_items
  ADD COLUMN IF NOT EXISTS manager_spo_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manager_spo_percent NUMERIC(5, 2);

COMMENT ON COLUMN pricebook_items.manager_spo_enabled IS 'When true, manager SPO % applies for roles defined in app (sales/regional/setter managers).';
COMMENT ON COLUMN pricebook_items.manager_spo_percent IS '% of adder selling price for eligible manager roles when manager_spo_enabled.';
