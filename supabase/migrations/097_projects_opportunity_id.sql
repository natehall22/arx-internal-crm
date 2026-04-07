/* Links CRM project (job folder) to the sales opportunity when present. Required by contract sign, /projects UI, and payroll export. */

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_opportunity_id ON projects(opportunity_id);

COMMENT ON COLUMN projects.opportunity_id IS 'When set, ties the project to the opportunity (inspection → close → sale).';
