-- Migration: Add streaming sessions and events tables for resumable streaming
-- This migration adds tables to track streaming sessions and persist events for replay

-- Create streaming_sessions table
CREATE TABLE IF NOT EXISTS streaming_sessions (
    id VARCHAR(64) PRIMARY KEY,
    thread_id VARCHAR(64) NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    owner_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    last_event_id VARCHAR(64),
    error_message TEXT
);

-- Create indexes for streaming_sessions
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_thread ON streaming_sessions(thread_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_owner ON streaming_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_status ON streaming_sessions(status) WHERE status = 'active';

-- Add check constraint for status values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_streaming_sessions_status'
    ) THEN
        ALTER TABLE streaming_sessions ADD CONSTRAINT ck_streaming_sessions_status
            CHECK (status IN ('active', 'completed', 'error'));
    END IF;
END$$;

-- Create streaming_events table
CREATE TABLE IF NOT EXISTS streaming_events (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES streaming_sessions(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for streaming_events
CREATE INDEX IF NOT EXISTS idx_streaming_events_session ON streaming_events(session_id);
CREATE INDEX IF NOT EXISTS idx_streaming_events_session_seq ON streaming_events(session_id, sequence_number);

-- Add unique constraint for session_id + sequence_number
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_session_sequence'
    ) THEN
        ALTER TABLE streaming_events ADD CONSTRAINT uq_session_sequence
            UNIQUE (session_id, sequence_number);
    END IF;
END$$;
