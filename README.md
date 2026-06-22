# Project Mneme

Personalized knowledge retention assistant — adaptive mastery tracking, decay-aware learning, and AI-generated revision content.

## Stack
- **Frontend**: React + Vite + shadcn/ui (Tailwind CSS) — dark mode, calm design
- **Backend**: Express.js + JWT auth
- **Database**: PostgreSQL + Cloudinary (files/resources)
- **AI**: OpenAI GPT-4o (concept extraction + content generation)

## Project Structure
```
Hackathon/
├── client/     React frontend
└── server/     Express backend
```

## Setup

### 1. Database
Create a PostgreSQL database and run the schema:
```bash
psql -U postgres -c "CREATE DATABASE mneme_db;"
psql -U postgres -d mneme_db -f server/migrations/001_schema.sql
```

### 2. Server
```bash
cd server
cp .env.example .env     # fill in your credentials
npm install
npm run dev              # runs on http://localhost:5000
```

### 3. Client
```bash
cd client
npm install
npm run dev              # runs on http://localhost:5173
```

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Current user |
| POST | /api/topics | Create topic |
| GET | /api/topics | List topics |
| GET | /api/topics/:id | Get topic |
| POST | /api/resources | Add resource (link/text/file) |
| POST | /api/resources/:id/process | Extract concepts via AI |
| GET | /api/concepts?topic_id= | List concepts |
| GET | /api/mastery/:user_id | Mastery overview |
| PATCH | /api/mastery/update | Log study session |
| GET | /api/recommendations/:user_id | Top-5 recommendations |
| POST | /api/content/generate | Generate revision or quiz |
| GET | /api/content?concept_id= | Get cached content |

## Core Engines

- **Mastery Engine** — `mastery = 0.2*time + 0.3*revisions + 0.5*quiz_avg`
- **Decay Engine** — Ebbinghaus forgetting curve modulated by difficulty + revision frequency
- **Recommendation Engine** — `priority = 0.6*(1-mastery) + 0.3*decay + 0.1*difficulty`
- **Knowledge Engine** — GPT-4o concept extraction from any resource
- **Content Engine** — GPT-4o adaptive revision notes and quizzes
