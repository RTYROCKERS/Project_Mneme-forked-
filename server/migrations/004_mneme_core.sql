-- Project Mneme — Migration 004: Mneme Core (the memory brain)
--
-- This is the additive "brain" layer that turns the study app into a
-- context-triggered personal memory agent. It is intentionally decoupled from
-- the existing topic/concept tables (those remain the "Manual Study Mode").
--
-- New tables:
--   mneme_sources    — per-source permissions (the "user controls everything" layer)
--   memories         — captured memory cards + embedding + personalized forgetting state
--   memory_links     — knowledge-graph edges between related memories
--   recall_events    — every recall/refresh outcome (drives the forgetting model)
--   observation_log  — audit trail of everything Mneme saw + whether it was kept
--
-- Safe to run on an existing database (idempotent). Existing tables untouched.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Sources & permissions
-- A "source" is a place Mneme can observe: a website domain, a desktop app, or
-- a terminal folder/repo. Permission is asked once per new source and remembered.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mneme_sources (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         VARCHAR(20)  NOT NULL CHECK (kind IN ('browser', 'terminal', 'desktop', 'other')),
  identifier   VARCHAR(512) NOT NULL,                 -- domain / app name / repo path
  label        VARCHAR(255),                          -- friendly display name
  permission   VARCHAR(20)  NOT NULL DEFAULT 'pending'
                 CHECK (permission IN ('always', 'once', 'never', 'pending')),
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,         -- auto-blocked categories (banking, etc.)
  capture_count INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, kind, identifier)
);

-- ---------------------------------------------------------------------------
-- Memories — the heart of Mneme.
-- One row per kept idea. Holds the clean "card" text, its meaning-fingerprint
-- (embedding), the origin, and the personalized forgetting-model state.
--
-- Forgetting model (FSRS-lite):
--   retrievability R(t) = 2 ^ ( -days_since_review / stability )
--   stability grows on correct recall, shrinks on lapse.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id      UUID REFERENCES mneme_sources(id) ON DELETE SET NULL,

  -- content
  card           TEXT NOT NULL,                        -- one clean sentence (the memory)
  detail         TEXT,                                 -- optional longer note
  embedding      JSONB,                                -- float[] meaning fingerprint
  difficulty     VARCHAR(20) NOT NULL DEFAULT 'intermediate'
                   CHECK (difficulty IN ('easy', 'intermediate', 'hard')),

  -- origin / provenance
  origin_kind    VARCHAR(20) NOT NULL DEFAULT 'browser',-- where it was captured
  origin_ref     TEXT,                                 -- url / command / file

  -- forgetting-model state
  stability        FLOAT NOT NULL DEFAULT 1.0,          -- days; higher = slower decay
  last_reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recall_count     INT NOT NULL DEFAULT 0,
  lapse_count      INT NOT NULL DEFAULT 0,

  -- "blind spot" support: how often the user re-encountered this before learning it
  lookup_count   INT NOT NULL DEFAULT 0,

  status         VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'archived', 'deleted')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Knowledge-graph links between related memories (cosine similarity edges).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_a    UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  memory_b    UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  similarity  FLOAT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CHECK (memory_a <> memory_b),
  UNIQUE (memory_a, memory_b)
);

-- ---------------------------------------------------------------------------
-- Recall events — every time a memory is surfaced and acted on.
-- This is the signal stream that trains the personalized forgetting model,
-- including the no-quiz implicit signals.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recall_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_id      UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,

  mode           VARCHAR(20) NOT NULL                  -- how it was surfaced
                   CHECK (mode IN ('quiz', 'show', 'auto')),
  -- outcome covers explicit (quiz) AND implicit (no-quiz) signals:
  --   correct/incorrect  -> quiz grade
  --   knew/kinda/forgot  -> confidence self-rating
  --   shown              -> passive "just show me"
  --   used               -> strong: applied it in real work
  --   relookup           -> strong: re-looked-it-up (forgot)
  outcome        VARCHAR(20) NOT NULL
                   CHECK (outcome IN ('correct', 'incorrect', 'knew', 'kinda',
                                      'forgot', 'shown', 'used', 'relookup')),

  retrievability_before FLOAT,                          -- predicted R at surface time
  stability_before      FLOAT,
  stability_after       FLOAT,
  context_ref           TEXT,                           -- what triggered it
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Observation log — full audit trail for "what Mneme recorded" (Control Center).
-- Every observed chunk, whether triage kept it or not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS observation_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id   UUID REFERENCES mneme_sources(id) ON DELETE SET NULL,
  raw_text    TEXT NOT NULL,
  kept        BOOLEAN NOT NULL DEFAULT FALSE,           -- did triage keep anything?
  memory_id   UUID REFERENCES memories(id) ON DELETE SET NULL,
  reason      TEXT,                                     -- why kept / discarded
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- User-level Mneme preferences (the "user controls everything" settings).
-- Stored on users.profile would work, but a dedicated table is cleaner.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mneme_settings (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_mode  VARCHAR(20) NOT NULL DEFAULT 'calm'    -- 'calm' (pull) | 'ambient' (push)
                   CHECK (delivery_mode IN ('calm', 'ambient')),
  interaction    VARCHAR(20) NOT NULL DEFAULT 'auto'    -- 'quiz' | 'show' | 'auto'
                   CHECK (interaction IN ('quiz', 'show', 'auto')),
  paused         BOOLEAN NOT NULL DEFAULT FALSE,         -- global pause
  resurface_threshold FLOAT NOT NULL DEFAULT 0.6,        -- surface when R below this
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mneme_sources_user     ON mneme_sources(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user          ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user_status   ON memories(user_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_last_reviewed ON memories(last_reviewed_at);
CREATE INDEX IF NOT EXISTS idx_memory_links_user      ON memory_links(user_id);
CREATE INDEX IF NOT EXISTS idx_recall_events_user     ON recall_events(user_id);
CREATE INDEX IF NOT EXISTS idx_recall_events_memory   ON recall_events(memory_id);
CREATE INDEX IF NOT EXISTS idx_observation_user       ON observation_log(user_id);
