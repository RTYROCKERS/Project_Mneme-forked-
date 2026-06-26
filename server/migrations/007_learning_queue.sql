-- Project Mneme — Migration 007: Learning queue ("learn this later")
--
-- The page-insight / "Learn this page" flow splits a page into:
--   1. KNOWN  — memories you already hold about this topic, surfaced worst-recall
--               first so you refresh what's decaying (handled by existing tables).
--   2. NEW    — concepts on the page you don't have yet. The user can "Learn now"
--               (captured straight into memories) or "Later".
--
-- "Later" items land here. They are NOT memories yet — they're a backlog the
-- Control Center rolls up (per source/topic) into a deliberate review session.
-- Resolving an item either promotes it to a real memory (status='learned') or
-- drops it (status='dismissed').
--
-- Safe to run on an existing database (idempotent). Existing data untouched.

CREATE TABLE IF NOT EXISTS learning_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card          TEXT NOT NULL,                       -- the concept to learn (one sentence)
  detail        TEXT,                                -- short elaboration
  difficulty    VARCHAR(20) NOT NULL DEFAULT 'intermediate'
                  CHECK (difficulty IN ('easy', 'intermediate', 'hard')),
  anchor        TEXT,                                -- the known idea it builds on ("you already know …")
  source_url    TEXT,
  source_title  TEXT,
  origin_kind   VARCHAR(20) NOT NULL DEFAULT 'browser'
                  CHECK (origin_kind IN ('browser', 'terminal', 'desktop', 'other')),
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'learned', 'dismissed')),
  memory_id     UUID REFERENCES memories(id) ON DELETE SET NULL,  -- set when promoted to a memory
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_learning_queue_user_status ON learning_queue(user_id, status);
