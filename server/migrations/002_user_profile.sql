-- Project Mneme — Migration 002: Learner Profile
--
-- Adds a learner profile to the users table. `profile_description` is a short
-- narrative (the learner's point of view, ability and goals) that is sent to
-- the AI on every generation; `profile` holds the structured version.
--
-- Safe to run on an existing database (idempotent).

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_description TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;
