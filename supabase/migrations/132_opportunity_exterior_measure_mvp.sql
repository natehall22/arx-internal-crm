-- ARX Exterior Measure MVP
-- Opportunity-first exterior reports for reps/inspectors, with optional job linkage for ops.

CREATE TABLE IF NOT EXISTS job_measure_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  measure_kind TEXT NOT NULL DEFAULT 'siding' CHECK (measure_kind IN ('roof', 'siding', 'windows', 'gutters_soffit_fascia', 'full_exterior')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'final')),
  report_title TEXT NOT NULL DEFAULT 'ARX Exterior Measure Report',
  waste_percent NUMERIC(6, 2) NOT NULL DEFAULT 10,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opportunity_id)
);

CREATE TABLE IF NOT EXISTS job_measure_elevations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES job_measure_reports(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  elevation_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  wall_width_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  wall_height_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  gable_width_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  gable_height_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  waste_percent NUMERIC(6, 2),
  soffit_depth_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  soffit_length_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  fascia_lf NUMERIC(10, 2) NOT NULL DEFAULT 0,
  gutter_lf NUMERIC(10, 2) NOT NULL DEFAULT 0,
  starter_strip_lf NUMERIC(10, 2) NOT NULL DEFAULT 0,
  j_channel_lf NUMERIC(10, 2) NOT NULL DEFAULT 0,
  inside_corners INTEGER NOT NULL DEFAULT 0,
  outside_corners INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_measure_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES job_measure_reports(id) ON DELETE CASCADE,
  elevation_id UUID NOT NULL REFERENCES job_measure_elevations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  opening_type TEXT NOT NULL DEFAULT 'window' CHECK (opening_type IN ('window', 'door', 'garage_door', 'other')),
  label TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  width_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  height_ft NUMERIC(10, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_measure_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES job_measure_reports(id) ON DELETE CASCADE,
  elevation_id UUID REFERENCES job_measure_elevations(id) ON DELETE SET NULL,
  opening_id UUID REFERENCES job_measure_openings(id) ON DELETE SET NULL,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  job_id UUID REFERENCES production_jobs(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  caption TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_measure_reports_org_id ON job_measure_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_reports_opportunity_id ON job_measure_reports(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_reports_job_id ON job_measure_reports(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_measure_elevations_report_id ON job_measure_elevations(report_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_elevations_opportunity_id ON job_measure_elevations(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_elevations_job_id ON job_measure_elevations(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_measure_openings_elevation_id ON job_measure_openings(elevation_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_openings_report_id ON job_measure_openings(report_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_openings_opportunity_id ON job_measure_openings(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_photos_report_id ON job_measure_photos(report_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_photos_elevation_id ON job_measure_photos(elevation_id);
CREATE INDEX IF NOT EXISTS idx_job_measure_photos_opportunity_id ON job_measure_photos(opportunity_id);

ALTER TABLE job_measure_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_measure_elevations ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_measure_openings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_measure_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view job measure reports in their org" ON job_measure_reports;
CREATE POLICY "Users can view job measure reports in their org"
  ON job_measure_reports FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job measure reports in their org" ON job_measure_reports;
CREATE POLICY "Users can create job measure reports in their org"
  ON job_measure_reports FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job measure reports in their org" ON job_measure_reports;
CREATE POLICY "Users can update job measure reports in their org"
  ON job_measure_reports FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can delete job measure reports in their org" ON job_measure_reports;
CREATE POLICY "Users can delete job measure reports in their org"
  ON job_measure_reports FOR DELETE USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view job measure elevations in their org" ON job_measure_elevations;
CREATE POLICY "Users can view job measure elevations in their org"
  ON job_measure_elevations FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job measure elevations in their org" ON job_measure_elevations;
CREATE POLICY "Users can create job measure elevations in their org"
  ON job_measure_elevations FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job measure elevations in their org" ON job_measure_elevations;
CREATE POLICY "Users can update job measure elevations in their org"
  ON job_measure_elevations FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can delete job measure elevations in their org" ON job_measure_elevations;
CREATE POLICY "Users can delete job measure elevations in their org"
  ON job_measure_elevations FOR DELETE USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view job measure openings in their org" ON job_measure_openings;
CREATE POLICY "Users can view job measure openings in their org"
  ON job_measure_openings FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job measure openings in their org" ON job_measure_openings;
CREATE POLICY "Users can create job measure openings in their org"
  ON job_measure_openings FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job measure openings in their org" ON job_measure_openings;
CREATE POLICY "Users can update job measure openings in their org"
  ON job_measure_openings FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can delete job measure openings in their org" ON job_measure_openings;
CREATE POLICY "Users can delete job measure openings in their org"
  ON job_measure_openings FOR DELETE USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can view job measure photos in their org" ON job_measure_photos;
CREATE POLICY "Users can view job measure photos in their org"
  ON job_measure_photos FOR SELECT USING (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can create job measure photos in their org" ON job_measure_photos;
CREATE POLICY "Users can create job measure photos in their org"
  ON job_measure_photos FOR INSERT WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can update job measure photos in their org" ON job_measure_photos;
CREATE POLICY "Users can update job measure photos in their org"
  ON job_measure_photos FOR UPDATE
  USING (org_id = get_user_org_id(auth.uid()))
  WITH CHECK (org_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Users can delete job measure photos in their org" ON job_measure_photos;
CREATE POLICY "Users can delete job measure photos in their org"
  ON job_measure_photos FOR DELETE USING (org_id = get_user_org_id(auth.uid()));

DROP TRIGGER IF EXISTS update_job_measure_reports_updated_at ON job_measure_reports;
CREATE TRIGGER update_job_measure_reports_updated_at
  BEFORE UPDATE ON job_measure_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_measure_elevations_updated_at ON job_measure_elevations;
CREATE TRIGGER update_job_measure_elevations_updated_at
  BEFORE UPDATE ON job_measure_elevations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_job_measure_openings_updated_at ON job_measure_openings;
CREATE TRIGGER update_job_measure_openings_updated_at
  BEFORE UPDATE ON job_measure_openings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE job_measure_reports IS 'Opportunity-first ARX Exterior Measure reports with optional production job linkage.';
COMMENT ON TABLE job_measure_elevations IS 'Manual elevation measurements and accessory linears.';
COMMENT ON TABLE job_measure_openings IS 'Windows, doors, and other deductions tied to an elevation.';
COMMENT ON TABLE job_measure_photos IS 'Measure photos attached to opportunity reports, elevations, or openings.';
