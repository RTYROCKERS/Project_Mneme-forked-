# Project Mneme

**Observe what matters, recall what fades.**

Mneme is a personal knowledge agent that watches what you read, code, and run — then helps you remember it before you forget. It pairs a classic **spaced-repetition study app** (Topics → Concepts → Quizzes, with adaptive mastery tracking) with an **ambient memory engine** that quietly captures the ideas worth keeping and resurfaces *your own* fading knowledge at the right moment, using an FSRS-lite forgetting-curve model. The same brain runs across your browser, your editor, and your terminal.

## Two modes

- **Study mode** — Create topics, let AI extract concepts, generate personalized revision notes and quizzes, and track mastery as it decays over time.
- **Ambient memory** — Observe pages/code/terminal sessions, triage what's worth remembering, dedupe and link ideas semantically, and resurface fading memories when they become relevant again.

## Stack
- **Frontend**: React + Vite + Tailwind CSS — dark mode, calm design
- **Backend**: Express.js + JWT auth
- **Database**: PostgreSQL (JSONB-stored embeddings, no pgvector needed) + Cloudinary (file resources)
- **AI**: Pluggable LLM facade — **Gemini** by default (chat + `text-embedding-004`), **Azure AI Foundry** optional for premium tasks. Switchable via env vars with zero engine changes.

## Project Structure
```
Hackathon/
├── client/            React + Vite web app (Study + Control Center)
├── server/            Express API — engines, routes, migrations
├── extension/         Browser extension (observe + "Learn this page")
├── vscode-extension/  VS Code extension (file & terminal-session briefings)
└── terminal-agent/    Standalone shell monitor (PowerShell/bash/zsh/cmd)
```

## Capture surfaces
All surfaces are thin clients that send text to the Mneme server, which holds the keys and runs the AI:

| Surface | What it watches |
|---------|-----------------|
| **Browser extension** | Pages you read (opt-in per site). "Learn this page" splits prerequisites into refresh / learn / already-solid and can save a page as a study Topic. |
| **VS Code extension** | "Get ready to read" a code file; monitors an agent's terminal session and briefs you when the work settles. |
| **Terminal agent** | Standalone shells outside VS Code — watches commands + file changes, briefs on settle. Zero dependencies. |
| **Web app** | Upload docs ("get me ready to read"), Control Center, recall tester, study & quiz. |

## Setup

### 1. Server
```bash
cd server
cp .env.example .env     # fill in DATABASE_URL, GEMINI_API_KEY, JWT_SECRET, Cloudinary
npm install
npm run migrate          # applies migrations 001–007 (idempotent)
npm run dev              # runs on http://localhost:5000  (run from server/ so .env loads)
```

### 2. Client
```bash
cd client
npm install
npm run dev              # runs on http://localhost:5173 (proxies /api → :5000)
```

### 3. Browser extension (optional)
Load `extension/` as an unpacked extension (Developer mode), open the popup, sign in, and keep the API URL as `http://localhost:5000`.

### Environment (server/.env)
```
PORT=5000
DATABASE_URL=postgresql://...
JWT_SECRET=...
GEMINI_API_KEY=...           GEMINI_MODEL=gemini-2.0-flash
CLOUDINARY_CLOUD_NAME=...     CLOUDINARY_API_KEY=...     CLOUDINARY_API_SECRET=...
CLIENT_URL=http://localhost:5173
# Optional provider routing:
# LLM_PROVIDER=gemini  LLM_SMART_PROVIDER=azure  LLM_EMBED_PROVIDER=gemini
# AZURE_OPENAI_ENDPOINT=...  AZURE_OPENAI_KEY=...  AZURE_OPENAI_DEPLOYMENT=...
```

## API Reference

### Auth & profile
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Current user |
| GET / PUT | /api/profile | Get / update learner profile |
| POST | /api/profile/chat | Coaching chatbot interview |
| POST | /api/profile/synthesize | Turn conversation into a profile |

### Study mode
| Method | Route | Description |
|--------|-------|-------------|
| POST / GET | /api/topics | Create / list topics |
| GET / PATCH / DELETE | /api/topics/:id | Get / update / delete topic |
| POST | /api/resources | Add resource (link/text/file) |
| POST | /api/resources/:id/process | Extract concepts via AI |
| GET | /api/concepts?topic_id= | List concepts |
| GET | /api/mastery/:user_id | Mastery overview |
| PATCH | /api/mastery/update | Log study session |
| GET | /api/recommendations/:user_id | Top-5 recommendations |
| POST | /api/content/generate | Generate revision or quiz |
| GET | /api/content?concept_id= | Get cached content |

### Mneme brain (ambient memory)
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/mneme/capture | Observe text → triage + embed + store |
| POST | /api/mneme/context | Resurface a fading, relevant memory |
| POST | /api/mneme/recall | Log a recall outcome → update model |
| POST | /api/mneme/explain | Plain-language refresher for a memory |
| GET / DELETE | /api/mneme/memories[/:id] | List / delete memories |
| GET | /api/mneme/strength | Retention stats |
| POST | /api/mneme/page-insight | "Learn this page" prerequisites + key points |
| POST | /api/mneme/doc-insight | "Get ready to read" a document |
| POST | /api/mneme/code-insight · /session-insight | Code file / terminal-session briefings |
| POST | /api/mneme/learn-now · /study-packet | Learn a concept now / save a briefing as a Topic |
| GET / POST | /api/mneme/learn-queue | "Learn later" backlog |
| GET / POST | /api/mneme/sources | Source permissions (always/once/never) |
| GET / PUT | /api/mneme/settings | Delivery & interaction modes, pause |
| GET / POST | /api/mneme/onboarding | Cold-start expertise + profile |
| GET | /api/mneme/status | Health + active providers |

## Core engines & the memory model

**Study mode**
- **Mastery Engine** — `mastery = 0.2*time + 0.3*revisions + 0.5*quiz_avg`
- **Decay Engine** — Ebbinghaus forgetting curve modulated by difficulty + revision frequency
- **Recommendation Engine** — `priority = 0.6*(1−mastery) + 0.3*decay + 0.1*difficulty`
- **Knowledge Engine** — AI concept extraction from any resource or topic
- **Content Engine** — adaptive revision notes and quizzes (profile-personalized)

**Ambient memory (FSRS-lite)**
- **Retrievability Engine** — `R(t) = 2^(−Δt / stability)`; a memory is "due" when `R < 0.6`. Stability rises/falls per recall outcome (correct, forgot, used, re-lookup…), with a bonus for recalling near-forgotten items.
- **Triage Engine** — ruthless filter: keep only genuinely reusable knowledge (≤3 cards/chunk); strips secrets (keys, passwords, tokens).
- **Embedding Engine** — cosine similarity for dedup (~0.78) and knowledge-graph links (~0.45); embeddings stored as JSONB.
- **Resurface Engine** — `priority = relevance × (0.4 + 0.6 × forgetting_need)`.
- **Profile Engine** — builds a learner profile that personalizes every generation.

## Migrations
`001` core schema · `002` user profile · `003` quiz bank · `004` Mneme core (memories, sources, recall events) · `005` cold-start onboarding · `006` onboarding profile · `007` learning queue.
