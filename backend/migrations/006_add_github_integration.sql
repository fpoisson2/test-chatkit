-- Migration: Add GitHub integration tables for workflow synchronization
-- This migration creates tables for GitHub OAuth connections, repo sync configs,
-- workflow mappings, and sync task tracking

-- =============================================================================
-- Table: github_integrations
-- Per-user GitHub OAuth connection
-- =============================================================================
CREATE TABLE IF NOT EXISTS github_integrations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_encrypted TEXT NOT NULL,
    access_token_hint VARCHAR(128),
    refresh_token_encrypted TEXT,
    refresh_token_hint VARCHAR(128),
    token_expires_at TIMESTAMP WITH TIME ZONE,
    github_user_id INTEGER NOT NULL,
    github_username VARCHAR(255) NOT NULL,
    github_email VARCHAR(255),
    github_avatar_url VARCHAR(512),
    scopes TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_github_integrations_user_id
    ON github_integrations(user_id);

-- =============================================================================
-- Table: github_repo_syncs
-- Repository sync configuration with file patterns
-- =============================================================================
CREATE TABLE IF NOT EXISTS github_repo_syncs (
    id SERIAL PRIMARY KEY,
    integration_id INTEGER NOT NULL REFERENCES github_integrations(id) ON DELETE CASCADE,
    repo_full_name VARCHAR(255) NOT NULL,
    branch VARCHAR(255) NOT NULL DEFAULT 'main',
    file_pattern VARCHAR(512) NOT NULL,
    sync_direction VARCHAR(20) NOT NULL DEFAULT 'bidirectional',
    auto_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    webhook_id INTEGER,
    webhook_secret_encrypted TEXT,
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_status VARCHAR(20),
    last_sync_error TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_github_repo_sync_repo_branch
        UNIQUE (integration_id, repo_full_name, branch)
);

CREATE INDEX IF NOT EXISTS ix_github_repo_syncs_integration_id
    ON github_repo_syncs(integration_id);

-- =============================================================================
-- Table: workflow_github_mappings
-- Maps workflows to GitHub files with sync metadata
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_github_mappings (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    repo_sync_id INTEGER NOT NULL REFERENCES github_repo_syncs(id) ON DELETE CASCADE,
    file_path VARCHAR(512) NOT NULL,
    github_sha VARCHAR(40),
    github_commit_sha VARCHAR(40),
    last_synced_version_id INTEGER REFERENCES workflow_definitions(id) ON DELETE SET NULL,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    last_pull_at TIMESTAMP WITH TIME ZONE,
    last_push_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_workflow_github_mapping UNIQUE (workflow_id, repo_sync_id),
    CONSTRAINT uq_github_file_path UNIQUE (repo_sync_id, file_path)
);

CREATE INDEX IF NOT EXISTS ix_workflow_github_mappings_workflow_id
    ON workflow_github_mappings(workflow_id);
CREATE INDEX IF NOT EXISTS ix_workflow_github_mappings_repo_sync_id
    ON workflow_github_mappings(repo_sync_id);

-- =============================================================================
-- Table: github_sync_tasks
-- Track background sync operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS github_sync_tasks (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(255) NOT NULL UNIQUE,
    repo_sync_id INTEGER NOT NULL REFERENCES github_repo_syncs(id) ON DELETE CASCADE,
    triggered_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    operation VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    files_processed INTEGER NOT NULL DEFAULT 0,
    files_total INTEGER NOT NULL DEFAULT 0,
    result_summary JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_github_sync_tasks_task_id
    ON github_sync_tasks(task_id);
CREATE INDEX IF NOT EXISTS ix_github_sync_tasks_repo_sync_id
    ON github_sync_tasks(repo_sync_id);
CREATE INDEX IF NOT EXISTS ix_github_sync_tasks_status
    ON github_sync_tasks(status);
