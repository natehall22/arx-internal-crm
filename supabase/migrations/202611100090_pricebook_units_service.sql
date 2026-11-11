-- Industry profiles (lib/industry-profiles.ts): service companies price add-ons per visit, per month and per hour.
-- Additive only: three new values on the `unit` enum used by pricebook_items.unit (prod today:
-- square, each, lf, sheet, job, percent, per_sqft, sqft). Nothing existing changes.
-- Until this is applied, saving an add-on with one of these units fails with the database's enum error;
-- the roofing profile never offers them, so the original company is unaffected.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older Postgres; on 17 it can, but the new values
-- can't be USED in the same transaction — nothing here uses them.

ALTER TYPE unit ADD VALUE IF NOT EXISTS 'visit';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'month';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'hour';
