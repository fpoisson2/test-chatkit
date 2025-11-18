-- Migration: Add parent_slug column to workflow_steps table
-- Purpose: Enable explicit parent-child relationships between workflow steps
--          (e.g., nodes inside while loops) instead of relying on UI position
-- Date: 2025-11-18

-- Add parent_slug column to define explicit hierarchical relationships
ALTER TABLE workflow_steps ADD COLUMN IF NOT EXISTS parent_slug VARCHAR(128) NULL;

-- Add index for faster queries on parent_slug
CREATE INDEX IF NOT EXISTS idx_workflow_steps_parent_slug ON workflow_steps(parent_slug);

-- Add index for combined definition_id + parent_slug lookups
CREATE INDEX IF NOT EXISTS idx_workflow_steps_def_parent ON workflow_steps(definition_id, parent_slug);

-- Verify the migration
-- SELECT slug, kind, parent_slug FROM workflow_steps WHERE parent_slug IS NOT NULL;
