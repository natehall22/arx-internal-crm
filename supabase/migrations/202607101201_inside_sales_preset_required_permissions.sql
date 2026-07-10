-- Repair the system "Inside Sales" permission preset on every org.
-- Additive only: inserts missing preset_permissions rows; never removes admin edits.

INSERT INTO preset_permissions (preset_id, permission_id)
SELECT pp.id, p.id
FROM permission_presets pp
JOIN permissions p ON p.name IN (
  'leads:view',
  'leads:create',
  'leads:edit',
  'leads:view_inbound',
  'leads:claim_inbound',
  'opportunities:view',
  'opportunities:edit',
  'scheduling:view',
  'scheduling:create'
)
WHERE pp.name = 'Inside Sales'
  AND NOT EXISTS (
    SELECT 1
    FROM preset_permissions existing
    WHERE existing.preset_id = pp.id
      AND existing.permission_id = p.id
  );
