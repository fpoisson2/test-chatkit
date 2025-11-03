-- Migration: Fix foreign key constraint for language_generation_tasks.language_id
-- This allows deleting languages without deleting associated generation tasks
-- The language_id will be set to NULL instead

-- Drop the existing foreign key constraint
ALTER TABLE language_generation_tasks
DROP CONSTRAINT IF EXISTS language_generation_tasks_language_id_fkey;

-- Add the new constraint with ON DELETE SET NULL
ALTER TABLE language_generation_tasks
ADD CONSTRAINT language_generation_tasks_language_id_fkey
FOREIGN KEY (language_id)
REFERENCES languages(id)
ON DELETE SET NULL;
