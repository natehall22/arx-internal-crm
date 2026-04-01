-- pricebook_items.unit uses enum `unit` (see 001_initial_schema.sql).
-- App UI uses per_sqft (manual sq ft for siding, etc.) and sqft (roof-derived); both must exist on the enum.

ALTER TYPE unit ADD VALUE IF NOT EXISTS 'per_sqft';
ALTER TYPE unit ADD VALUE IF NOT EXISTS 'sqft';
