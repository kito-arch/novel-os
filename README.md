# Novel OS

A voice-first story-writing assistant. Dictate scenes, extract characters and facts automatically, then browse and edit your story world through an AI-powered narrative layer.

---

## Prerequisites

- **Node.js 24+** (`node -v`)
- **PostgreSQL 16+** (local or Docker)
- **OpenAI API key** (or another LLM provider configured in env)
- **AssemblyAI API key** (for voice dictation — optional in dev with mock mode)
- **AWS credentials** (for SQS async processing — optional in dev)

---

## Local development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/novelos
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
```

Leave `STT_PROVIDER=mock` to skip AssemblyAI and use the built-in mock for dictation in dev.

### 3. Create the database

```bash
createdb novelos           # or use your PostgreSQL client
npm run db:migrate         # applies all Drizzle migrations
```

Optional — seed a sample story and character:

```bash
DATABASE_URL=postgres://... npx tsx scripts/seed.ts
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes (prod) | — | PostgreSQL connection string |
| `LLM_PROVIDER` | Yes | `openai` | LLM backend (`openai`) |
| `LLM_API_KEY` | Yes (real provider) | — | API key for the LLM provider |
| `LLM_CHEAP_MODEL` | No | `gpt-4o-mini` | Model for lightweight tasks |
| `LLM_STANDARD_MODEL` | No | `gpt-4o` | Model for standard agent tasks |
| `LLM_BEST_MODEL` | No | `gpt-4o` | Model for high-accuracy tasks |
| `STT_PROVIDER` | No | `mock` | Speech-to-text backend (`assemblyai` or `mock`) |
| `STT_API_KEY` | If STT≠mock | — | AssemblyAI API key |
| `AWS_REGION` | If SQS used | `us-east-1` | AWS region for the SQS queue |
| `SQS_QUEUE_URL` | If STT≠mock | — | Full SQS queue URL |
| `WEBHOOK_SECRET` | If STT≠mock | — | Shared secret for AssemblyAI callback auth |

---

## Running tests

```bash
npm test               # run all tests once
npm run test:watch     # watch mode
```

Tests use in-memory mock adapters and never require a running database or API keys.

---

## Type-checking and linting

```bash
npm run typecheck
npm run lint
```

---

## Docker deployment

Copy and fill in the production env file:

```bash
cp .env.production.example .env.production
```

Start everything (Postgres + migrations + app):

```bash
docker compose up --build
```

The app runs on port 3000. The `migrate` service runs once before the app starts. See `docker-compose.yml` for service details and `.env.production.example` for all required variables.

---

## Architecture overview

```
src/
  config/          # Zod-validated env config, startup validation
  domain/          # Pure TypeScript types — entities, facts, scenes, chapters
  adapters/
    postgres/      # Drizzle ORM implementations
    mock/          # In-memory adapters for tests and local dev
  services/        # Application logic — agent loop, context builder, extraction
  container/       # ioctopus IoC composition root; port contracts (tokens)
  server/          # resolveContainer — builds and caches the DI container
  app/             # Next.js App Router pages and API routes
  ui/              # React components

drizzle/
  schema.ts        # Drizzle table definitions
  migrations/      # SQL migration files

tests/
  domain/          # Pure domain type unit tests
  services/        # Service unit tests (mock adapters)
  adapters/        # Adapter contract suites
  integration/     # Full pipeline integration tests
```

### Request flow

1. Browser uploads audio → `POST /api/dictations`
2. API saves dictation, submits to AssemblyAI, enqueues SQS job
3. AssemblyAI POSTs transcript to `/api/webhook/assemblyai`
4. SQS worker calls `processTranscription`:
   - Retrieves transcript + story world context
   - Calls LLM agent loop with extraction tools
   - Commits extracted entities/facts to the story world store
5. Client polls `/api/dictations/:id/status` and reflects updates in the UI
