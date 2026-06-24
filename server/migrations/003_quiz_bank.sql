-- Project Mneme — Migration 003: Quiz Question Bank
--
-- Concept generation no longer depends on uploaded resources; concepts are
-- generated from the topic + description + learner profile. Revision sessions
-- now also generate a few quiz questions per concept and store them here so
-- they can be re-served later as interleaved warm-up questions for OTHER
-- concepts (spaced retrieval practice).
--
-- Safe to run on an existing database (idempotent). The `resources` table is
-- intentionally left untouched.

CREATE TABLE IF NOT EXISTS quiz_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INT NOT NULL,
  explanation TEXT,
  difficulty_level VARCHAR(50) DEFAULT 'intermediate',
  times_served INT DEFAULT 0,
  last_served_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_user ON quiz_questions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_concept ON quiz_questions(concept_id);
