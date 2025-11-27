-- Migration: Add workflow ownership and sharing
-- This migration adds owner_id to workflows and creates the workflow_shares table

-- Add owner_id column to workflows table
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Create index on owner_id for faster lookups
CREATE INDEX IF NOT EXISTS ix_workflows_owner_id ON workflows(owner_id);

-- Create workflow_shares table for sharing workflows with other users
CREATE TABLE IF NOT EXISTS workflow_shares (
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workflow_id, user_id)
);

-- Create index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS ix_workflow_shares_user_id ON workflow_shares(user_id);
