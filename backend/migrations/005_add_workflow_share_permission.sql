-- Migration: Add permission column to workflow_shares
-- This migration adds the permission field to allow read/write access control

-- Add permission column with default 'read'
ALTER TABLE workflow_shares ADD COLUMN IF NOT EXISTS permission VARCHAR(16) NOT NULL DEFAULT 'read';

-- Add check constraint to ensure valid permission values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_workflow_shares_permission'
    ) THEN
        ALTER TABLE workflow_shares ADD CONSTRAINT ck_workflow_shares_permission
            CHECK (permission IN ('read', 'write'));
    END IF;
END$$;
