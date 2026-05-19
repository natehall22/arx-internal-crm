INSERT INTO permissions (name, display_name, description, category)
VALUES
  ('ops:dashboard:view', 'View Ops Dashboard', 'Access production operations dashboard metrics', 'Operations'),
  ('jobs:view', 'View Job Board', 'Access production job board and job detail records', 'Operations'),
  ('jobs:edit', 'Edit Production Jobs', 'Modify production jobs, scheduling, and operational details', 'Operations'),
  ('jobs:financials:view', 'View Job Financials', 'See production job cost and profitability fields', 'Operations')
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;
