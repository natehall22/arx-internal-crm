INSERT INTO permissions (name, display_name, description, category)
VALUES
  ('customers:view', 'View Customers', 'Access customer records', 'Customers'),
  ('customers:edit', 'Edit Customers', 'Modify customer records', 'Customers')
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;
