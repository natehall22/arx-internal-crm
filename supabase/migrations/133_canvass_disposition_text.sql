-- Allow admin-defined canvass disposition ids to be saved as map pins.
-- The app stores disposition configuration in orgs.settings.canvass_dispositions,
-- so this column must accept custom ids beyond the original Postgres enum values.

ALTER TABLE leads
  ALTER COLUMN canvass_disposition TYPE TEXT
  USING canvass_disposition::text;
