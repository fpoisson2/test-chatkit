-- Migration: Add workflow generation tables
-- This migration creates tables for AI-powered workflow generation

-- Create workflow_generation_prompts table
CREATE TABLE IF NOT EXISTS workflow_generation_prompts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    model VARCHAR(100) NOT NULL,
    effort VARCHAR(20) NOT NULL DEFAULT 'medium',
    verbosity VARCHAR(20) NOT NULL DEFAULT 'medium',
    developer_message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index on name for faster lookups
CREATE INDEX IF NOT EXISTS ix_workflow_generation_prompts_id ON workflow_generation_prompts(id);

-- Create workflow_generation_tasks table
CREATE TABLE IF NOT EXISTS workflow_generation_tasks (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL UNIQUE,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    prompt_id INTEGER REFERENCES workflow_generation_prompts(id) ON DELETE SET NULL,
    user_message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    result_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for workflow_generation_tasks
CREATE INDEX IF NOT EXISTS ix_workflow_generation_tasks_id ON workflow_generation_tasks(id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_workflow_generation_tasks_task_id ON workflow_generation_tasks(task_id);
CREATE INDEX IF NOT EXISTS ix_workflow_generation_tasks_status ON workflow_generation_tasks(status);
CREATE INDEX IF NOT EXISTS ix_workflow_generation_tasks_workflow_id ON workflow_generation_tasks(workflow_id);
