-- Project Mneme — Migration 006: Structured onboarding profile
--
-- The first-run prior was just "what are you into?" (expertise domains). That is
-- not enough to judge relevance against WHO the user actually is. This adds a
-- small structured profile captured during onboarding:
--
--   profile = {
--     role:      "Software Engineering Intern",        -- current position (required)
--     education: { current: "BSc Computer Science · MIT", past: "..." },  -- (current required)
--     focus:     "Backend infrastructure & APIs"        -- stable focus area (required)
--   }
--
-- Like the expertise prior, this stores NO memories — it only enriches the
-- triage narrative (users.profile_description) so Mneme knows the person's role,
-- background and current focus when deciding what matters to them.
--
-- Safe to run on an existing database (idempotent). Existing data untouched.

ALTER TABLE mneme_settings
  ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;
