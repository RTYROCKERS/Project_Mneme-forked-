-- Project Mneme — Migration 005: First-run Onboarding (cold-start)
--
-- A first-time user has an EMPTY brain. This migration adds the two pieces the
-- staged onboarding needs, without ever fabricating "solid" knowledge:
--
--   1. The PRIOR (mneme_settings.expertise + onboarded)
--      A lightweight "what are you into?" calibration. It does NOT create
--      memories — it only tunes how chatty Mneme is per domain (quiet where the
--      user is expert, eager where they're new) by feeding the triage profile.
--
--   2. DECAYING DECLARED ANCHORS (memories.is_declared)
--      The optional "brain dump": things the user *claims* to know. These are
--      stored as weak, fast-fading memories — honest about the fact that a claim
--      is not proof of recall. They strengthen only if real-life encounters
--      confirm them, and quietly fade otherwise. is_declared marks them so the
--      UI can badge them and the model can treat them as low-confidence.
--
-- Safe to run on an existing database (idempotent). Existing data untouched.

-- The prior: structured expertise + a one-time "have they onboarded?" flag.
ALTER TABLE mneme_settings
  ADD COLUMN IF NOT EXISTS onboarded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mneme_settings
  ADD COLUMN IF NOT EXISTS expertise JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Declared anchors: weak, decaying memories seeded from the brain dump.
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS is_declared BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_memories_declared ON memories(user_id, is_declared);
