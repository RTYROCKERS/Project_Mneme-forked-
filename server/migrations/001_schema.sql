-- Project Mneme — Database Schema v1

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Topics
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  learning_goal VARCHAR(100) DEFAULT 'general',  -- e.g. 'interviews', 'exams', 'general'
  depth_level VARCHAR(50) DEFAULT 'intermediate', -- 'beginner', 'intermediate', 'advanced'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resources (links, text, uploaded files via Cloudinary)
CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('link', 'text', 'file')),
  title VARCHAR(255),
  url TEXT,                         -- for 'link' type
  content_text TEXT,                -- for 'text' type
  cloudinary_url TEXT,              -- for 'file' type
  cloudinary_public_id TEXT,        -- for deletion from Cloudinary
  file_name VARCHAR(255),
  processed BOOLEAN DEFAULT FALSE,  -- has concept extraction run?
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Concepts extracted from resources
CREATE TABLE IF NOT EXISTS concepts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  difficulty_level VARCHAR(50) DEFAULT 'intermediate', -- 'easy', 'intermediate', 'hard'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-user mastery records per concept
CREATE TABLE IF NOT EXISTS mastery_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mastery_score FLOAT DEFAULT 0.0 CHECK (mastery_score >= 0 AND mastery_score <= 1),
  time_spent_seconds INT DEFAULT 0,
  revision_count INT DEFAULT 0,
  quiz_avg_score FLOAT DEFAULT 0.0 CHECK (quiz_avg_score >= 0 AND quiz_avg_score <= 1),
  last_reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, concept_id)
);

-- Individual quiz attempts
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  score FLOAT NOT NULL CHECK (score >= 0 AND score <= 1),
  total_questions INT NOT NULL,
  correct_answers INT NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-generated content cache
CREATE TABLE IF NOT EXISTS generated_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('revision', 'quiz')),
  difficulty_level VARCHAR(50) DEFAULT 'intermediate',
  content_blob JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recommendation log for explainability
CREATE TABLE IF NOT EXISTS recommendation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  priority_score FLOAT NOT NULL,
  reason_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_topics_user_id ON topics(user_id);
CREATE INDEX IF NOT EXISTS idx_resources_topic_id ON resources(topic_id);
CREATE INDEX IF NOT EXISTS idx_concepts_topic_id ON concepts(topic_id);
CREATE INDEX IF NOT EXISTS idx_mastery_user_id ON mastery_records(user_id);
CREATE INDEX IF NOT EXISTS idx_mastery_concept_id ON mastery_records(concept_id);
CREATE INDEX IF NOT EXISTS idx_quiz_user_concept ON quiz_attempts(user_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_content_concept_type ON generated_content(concept_id, type);
CREATE INDEX IF NOT EXISTS idx_reco_user_id ON recommendation_log(user_id);
