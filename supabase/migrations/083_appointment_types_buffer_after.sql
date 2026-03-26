-- "After slot" buffer for feedback prompt timing — editable per type under Admin → Scheduling.
ALTER TABLE appointment_types ADD COLUMN IF NOT EXISTS buffer_after_minutes INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN appointment_types.buffer_after_minutes IS
  'Minutes after slot end toward inspection feedback prompt timing (with org inspection_feedback_buffer_minutes).';
