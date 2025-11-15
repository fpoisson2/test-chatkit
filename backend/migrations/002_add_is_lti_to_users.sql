-- Migration: Add is_lti column to users table
-- Purpose: Properly identify LTI users regardless of their email format
-- Date: 2025-11-15

-- Add is_lti column with default value FALSE
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_lti BOOLEAN NOT NULL DEFAULT FALSE;

-- Update existing users with @lti.local emails to be marked as LTI users
UPDATE users SET is_lti = TRUE WHERE email LIKE '%@lti.local';

-- Create index for faster queries on is_lti
CREATE INDEX IF NOT EXISTS idx_users_is_lti ON users(is_lti);

-- Verify the migration
-- SELECT email, is_lti FROM users WHERE is_lti = TRUE;
