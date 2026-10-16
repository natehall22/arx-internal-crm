-- Order Form: a dedicated "Color / Style" line next to Material, so the color the customer chose is
-- on the signed contract instead of buried in notes. Additive and nullable; old contracts stay NULL.
ALTER TABLE order_form_contracts
  ADD COLUMN IF NOT EXISTS roofing_color_style TEXT;

COMMENT ON COLUMN order_form_contracts.roofing_color_style IS
  'Shingle/gutter/siding color or style the customer selected (free text). NULL on contracts signed before 2026-10-16.';
