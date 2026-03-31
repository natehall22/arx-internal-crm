-- Sales → ops handoff: structured questionnaire stored for pre-fill; also copied to job notes.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_review JSONB;

COMMENT ON COLUMN projects.project_review IS
  'Last submitted project review questionnaire (answers + metadata for pre-fill on re-open)';
