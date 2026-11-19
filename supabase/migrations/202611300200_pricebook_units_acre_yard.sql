-- Land units for the price book: per acre (mowing, clearing, seeding) and per cubic yard (dirt, fill, grading).
-- ADDITIVE ONLY: two new values on the DB enum `unit` (pricebook_items.unit). Nothing existing changes.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe to re-run; the values are not used in this file.
SET LOCAL lock_timeout = '5s';

ALTER TYPE unit ADD VALUE IF NOT EXISTS 'acre';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'yard';
