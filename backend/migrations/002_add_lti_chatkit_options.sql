-- Migration: Add ChatKit options for LTI workflows
-- Adds fields to control sidebar, header, and history visibility in LTI context

-- Add lti_show_sidebar column
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS lti_show_sidebar BOOLEAN NOT NULL DEFAULT TRUE;

-- Add lti_show_header column
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS lti_show_header BOOLEAN NOT NULL DEFAULT TRUE;

-- Add lti_enable_history column
ALTER TABLE workflows
ADD COLUMN IF NOT EXISTS lti_enable_history BOOLEAN NOT NULL DEFAULT TRUE;
