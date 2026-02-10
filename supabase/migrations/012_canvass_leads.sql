-- Canvass lead dispositions + scheduling

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'canvass_disposition') THEN
    CREATE TYPE canvass_disposition AS ENUM (
      'not_home',
      'bad_roof',
      'renter',
      'go_back',
      'hot_lead',
      'not_interested'
    );
  END IF;
END $$;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS canvass_disposition canvass_disposition,
  ADD COLUMN IF NOT EXISTS canvass_notes TEXT,
  ADD COLUMN IF NOT EXISTS closer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_scheduled_for TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_canvass_disposition ON leads(canvass_disposition);
CREATE INDEX IF NOT EXISTS idx_leads_closer_user_id ON leads(closer_user_id);
