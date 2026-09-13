# NovelOS — Implementation Plan

## 1. Overview

**NovelOS** is a voice-first writing/worldbuilding environment for novelists. The writer dictates prose via microphone; AssemblyAI transcribes the audio; a tiered LLM pipeline extracts structured entities (characters, places, events, facts, knowledge, relationships, timelines, plot threads) from the raw transcript; those entities are stored as a **story world knowledge graph** (never as flat notes); and the writer can then query, inspect, and debug their story through a rich UI.

Key architectural principles:

- **LLM never writes directly to the database.** It produces a typed `StoryChangeProposal` (Zod-validated JSON). Application code validates, resolves, deduplicates, and commits.
- **Fact vs. Inference separation.** Every stored fact carries a confidence level (`explicit | implied | inferred | unknown`) and a provenance pointer back to the exact transcript chunk and dictation job.
- **Event-centric model.** Characters, places, and relationships are all derived views over an append-only event log. The event log is the source of truth.
- **Open, dynamic entity model, with a small guaranteed core.** Two layers:
  - **Core types (present in every story, designed explicitly):** `character`, `place`, and the **relationship** edge (links between any entities). These have their own flows — portrait/photo upload, the character sheet, the place card, the relationship graph — so they are first-class, not generic.
  - **Dynamic types (everything else):** new entity types are created at runtime by the user (UI/API), chosen by a story-type preset, or proposed on the fly by the extraction LLM — e.g. "these ships are Falcon-class cruisers…" → a `starship` type. Every dynamic type derives from a **base kind** that determines its capabilities: `physical` (concrete things like a starship — supports attaching images) or `abstract` (factions, concepts, plot devices — text only). A story-type preset like `space-opera` seeds `starship` (physical), `planet` (place), `faction` (abstract).
  - All generic logic (resolver, context builder, commit, list/detail UI) operates over `Entity` via its `entityType` + `attributes` — never through `if (entity.kind === 'character')` branches. Only the core flows (character/place/relationship) are allowed to specialize.
- **Tiered LLM routing.** Cheap models handle high-volume extraction; better models handle contradiction resolution and entity deduplication; the best model is reserved for on-demand analysis (story debugger, character deep-dive).
- **Selective retrieval.** Never send the entire novel to the LLM. A `ContextBuilder` retrieves only the relevant entities and events for the current dictation chunk.
- **Hexagonal / Ports & Adapters architecture.** Every external system (STT, LLM, database, job queue, vector store) is behind a TypeScript interface. Swapping providers means writing a new adapter, not changing application code.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React Server Components) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM (schema-first, type-safe) |
| Vector Store | pgvector (PostgreSQL extension) |
| Queue | AWS SQS (fully managed — no Redis/BullMQ broker to run) |
| STT | AssemblyAI (async transcription API) |
| LLM | OpenAI API (GPT-5 nano / mini / pro — tiered) |
| Validation | Zod |
| Auth | NextAuth.js (or Clerk — TBD) |
| State Management | Server Components + React Server Actions |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| Deployment | Vercel or AWS (app) + Supabase or RDS (Postgres) + AWS SQS |

---

## 3. Project Structure

```
novel-os/
├── app/                              # Next.js App Router
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── layout.tsx
│   ├── (app)/
│   │   ├── layout.tsx                # Main app shell (sidebar + content)
│   │   ├── page.tsx                  # Dashboard / story list
│   │   ├── story/
│   │   │   ├── [storyId]/
│   │   │   │   ├── page.tsx          # Story overview
│   │   │   │   ├── dictate/page.tsx  # Dictation screen (mic + live transcript)
│   │   │   │   ├── manuscript/page.tsx
│   │   │   │   ├── characters/
│   │   │   │   │   ├── page.tsx      # Character list
│   │   │   │   │   └── [characterId]/page.tsx
│   │   │   │   ├── locations/page.tsx
│   │   │   │   ├── timeline/page.tsx
│   │   │   │   ├── events/page.tsx
│   │   │   │   ├── relationships/page.tsx
│   │   │   │   ├── knowledge/page.tsx
│   │   │   │   ├── secrets/page.tsx
│   │   │   │   ├── plot-threads/page.tsx
│   │   │   │   ├── open-questions/page.tsx
│   │   │   │   └── debugger/page.tsx  # Story debugger / continuity checker
│   │   │   └── page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── dictations/
│   │   │   └── route.ts              # POST: upload audio, create dictation job
│   │   ├── dictations/[id]/
│   │   │   └── route.ts              # GET: dictation status + transcript
│   │   ├── stories/
│   │   │   ├── route.ts              # CRUD stories
│   │   │   └── [storyId]/
│   │   │       ├── route.ts          # GET/PATCH/DELETE single story
│   │   │       ├── export/route.ts   # Export story world as JSON/Markdown
│   │   │       ├── ask/route.ts      # POST: "ask my story anything"
│   │   │       ├── analyze/route.ts  # POST: run continuity checker
│   │   │       └── knowledge/
│   │   │           └── route.ts      # POST: "Does character X know Y?"
│   │   └── hooks/
│   │       └── stt-callback/route.ts   # AssemblyAI STT webhook; verify WEBHOOK_SECRET
│   └── layout.tsx                    # Root layout (providers, fonts)
├── src/
│   ├── core/
│   │   ├── domain/                   # Pure domain types + logic (zero I/O)
│   │   │   ├── story-world.ts        # StoryWorld aggregate
│   │   │   ├── entity-types.ts       # AttributeDef, EntityType, builtin seeds + story-type presets
│   │   │   ├── entities.ts           # Generic Entity + attribute validation helpers
│   │   │   ├── events.ts             # Event types, event log operations
│   │   │   ├── knowledge.ts          # Who-knows-what system (any entity type)
│   │   │   ├── timeline.ts           # Timeline normalization + ordering
│   │   │   ├── confidence.ts         # Fact vs. inference classification
│   │   │   ├── proposals.ts          # StoryChangeProposal types + schema
│   │   │   └── index.ts
│   │   ├── container/                 # IoC abstraction layer (@evyweb/ioctopus)
│   │   │   ├── registry.ts            # AppRegistry — injection tokens → port contracts
│   │   │   ├── llm.ts                 # LlmClient port contract (tiered)
│   │   │   ├── stt.ts                 # SpeechToText port contract
│   │   │   ├── story-world-store.ts   # StoryWorldStore port contract
│   │   │   ├── transcript-store.ts    # TranscriptStore port contract
│   │   │   ├── semantic-store.ts      # SemanticStore port contract (vector search)
│   │   │   ├── job-queue.ts           # JobQueue port contract
│   │   │   ├── clock.ts               # Clock port contract
│   │   │   └── index.ts               # buildContainer / createAppModule (composition root)
│   │   ├── errors.ts                 # Domain error types
│   │   └── types.ts                  # Shared utility types
│   ├── adapters/                     # Concrete implementations of ports
│   │   ├── assemblyai/
│   │   │   ├── stt.ts               # AssemblyAI STT adapter
│   │   │   └── index.ts
│   │   ├── openai/
│   │   │   ├── llm.ts               # OpenAI LLM adapter (tiered)
│   │   │   └── index.ts
│   │   ├── drizzle/
│   │   │   ├── store.ts             # Drizzle-based StoryWorldStore
│   │   │   ├── transcript.ts        # Drizzle-based TranscriptStore
│   │   │   ├── migrations/
│   │   │   └── index.ts
│   │   ├── pgvector/
│   │   │   ├── embeddings.ts        # pgvector-based EmbeddingStore
│   │   │   └── index.ts
│   │   ├── in-memory/
│   │   │   ├── store.ts             # In-memory store (dev/testing)
│   │   │   ├── transcript.ts
│   │   │   └── index.ts
│   │   └── sqs/
│   │       ├── queue.ts             # SQS-based JobQueue
│   │       └── index.ts
│   ├── application/                  # Use cases / application services
│   │   ├── dictation/
│   │   │   ├── process-dictation.ts  # Orchestrates: audio → STT → extract → commit
│   │   │   └── index.ts
│   │   ├── extraction/
│   │   │   ├── extract-entities.ts   # LLM call: transcript → StoryChangeProposal
│   │   │   ├── resolve-proposals.ts  # Validate, deduplicate, merge proposals
│   │   │   ├── commit-proposals.ts   # Apply validated proposals to story world
│   │   │   ├── prompts.ts            # Extraction prompt templates
│   │   │   └── index.ts
│   │   ├── context/
│   │   │   ├── context-builder.ts    # Retrieves relevant context for a transcript chunk
│   │   │   ├── entity-resolver.ts    # Resolves entity mentions to IDs
│   │   │   └── index.ts
│   │   ├── reasoning/
│   │   │   ├── ask-story.ts          # "Ask my story anything" RAG pipeline
│   │   │   ├── knowledge-query.ts    # "Does character X know Y?"
│   │   │   ├── continuity-checker.ts # Story debugger / contradiction finder
│   │   │   ├── character-analysis.ts # Deep character analysis
│   │   │   └── index.ts
│   │   └── export/
│   │       ├── export-story.ts       # Export story world
│   │       └── index.ts
│   ├── infrastructure/
│   │   ├── config.ts                 # Environment + config validation
│   │   └── logger.ts                 # Structured logging
│   │                               # (composition root lives in src/container/ — ioctopus)
│   └── ui/
│       ├── components/
│       │   ├── layout/
│       │   │   ├── sidebar.tsx       # Left navigation sidebar
│       │   │   ├── header.tsx
│       │   │   └── shell.tsx
│       │   ├── dictate/
│       │   │   ├── mic-button.tsx    # Record/stop button
│       │   │   ├── live-transcript.tsx
│       │   │   └── processing-status.tsx
│       │   ├── story/
│       │   │   ├── character-card.tsx
│       │   │   ├── location-card.tsx
│       │   │   ├── event-card.tsx
│       │   │   ├── relationship-graph.tsx
│       │   │   ├── timeline-view.tsx
│       │   │   ├── knowledge-view.tsx
│       │   │   └── plot-thread-card.tsx
│       │   ├── debugger/
│       │   │   ├── continuity-report.tsx
│       │   │   └── contradiction-card.tsx
│       │   └── shared/
│       │       ├── confidence-badge.tsx
│       │       ├── entity-search.tsx
│       │       └── knowledge-status.tsx
│       └── lib/
│           ├── api-client.ts         # Typed fetch wrapper
│           └── hooks.ts             # React hooks for data fetching
├── workers/
│   └── extraction-worker.ts          # SQS consumer: processes dictation jobs
├── drizzle/
│   ├── schema.ts                     # Drizzle schema definition
│   └── migrations/                   # Auto-generated migrations
├── tests/
│   ├── unit/
│   │   ├── domain/
│   │   ├── extraction/
│   │   ├── context/
│   │   └── reasoning/
│   ├── integration/
│   │   ├── store.test.ts
│   │   └── extraction-pipeline.test.ts
│   └── e2e/
│       └── dictate-and-query.spec.ts
├── scripts/
│   ├── seed-story.ts                 # Seed database with sample story world
│   └── test-extraction.ts            # Manual extraction test script
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 4. Database Schema (Drizzle)

### 4.1 Core Tables

```typescript
// drizzle/schema.ts

import { pgTable, uuid, text, timestamp, jsonb, integer, real, pgEnum, uniqueIndex, index } from 'drizzle-orm/pg-core';

// Enums
export const confidenceEnum = pgEnum('confidence', ['explicit', 'implied', 'inferred', 'unknown']);
export const knowledgeStatusEnum = pgEnum('knowledge_status', ['known', 'unknown', 'believed_true', 'believed_false']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'completed', 'failed']);
export const plotThreadStatusEnum = pgEnum('plot_thread_status', ['introduced', 'active', 'resolved', 'abandoned']);
export const contradictionActionEnum = pgEnum('contradiction_action', ['supersede', 'flag_soft', 'flag_hard', 'ignore']);

// Stories
export const stories = pgTable('stories', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  synopsis: text('synopsis'),
  ownerId: text('owner_id').notNull(),
  storyType: text('story_type'),  // e.g. "space-opera" — selects preset entity types at creation
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Dictations (raw audio + transcript).
// Multi-tenant: every row is owned by `userId`. Async attribution is by `providerJobId`
// (the AssemblyAI transcript_id stored at submit time). The STT webhook carries only
// transcript_id, so the callback handler resolves transcript_id -> this row -> user/story;
// user identity is NEVER passed in the webhook URL.
export const dictations = pgTable('dictations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),          // owning user (multi-tenant)
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  audioUrl: text('audio_url'),
  providerJobId: text('provider_job_id'),      // AssemblyAI transcript_id
  transcript: text('transcript'),
  wordCount: integer('word_count'),
  durationSeconds: real('duration_seconds'),
  status: jobStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
}, (table) => ({
  providerJobIdIdx: uniqueIndex('dictations_provider_job_id_idx').on(table.providerJobId),
}));

// Entity types — the dynamic entity registry.
// A story's entity model is DATA, not code. Core types `character` and `place` are
// seeded into every story (guaranteed present, with image support + dedicated flows).
// Everything else is dynamic: a story-type preset (e.g. "space-opera") adds more
// (starship, faction, planet, ...); the extraction LLM can propose new types on the
// fly; the user can create types in the UI. Every type derives from a BASE KIND
// (character | place | physical | abstract) that drives capabilities (image support).
// Rows with story_id NULL are shared templates (builtins/presets).
export const entityTypes = pgTable('entity_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').references(() => stories.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),               // stable key per story, e.g. "character" | "starship"
  pluralName: text('plural_name').notNull(),  // "characters" | "starships"
  description: text('description'),
  baseKind: text('base_kind').notNull(),      // 'character' | 'place' | 'physical' | 'abstract' (extensible)
  attributeDefs: jsonb('attribute_defs').$type<AttributeDef[]>().default([]),
  origin: text('origin').notNull(),           // 'core' | 'preset' | 'extracted' | 'user'
  supersededBy: uuid('superseded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Unique per story; templates shared across stories share the NULL story_id space.
  storyNameIdx: uniqueIndex('entity_types_story_name_idx').on(table.storyId, table.name),
}));

// Entities (of any registered type)
export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  entityTypeId: uuid('entity_type_id').notNull().references(() => entityTypes.id),
  name: text('name').notNull(),
  aliases: jsonb('aliases').$type<string[]>().default([]),
  // All type-specific fields (goals, fears, appearance, cargo, captain, ...) live here.
  // Validated at commit time against the referenced entity type's attributeDefs.
  attributes: jsonb('attributes').$type<Record<string, AttributeValue>>().default({}),
}, (table) => ({
  storyNameIdx: uniqueIndex('entities_story_name_idx').on(table.storyId, table.name),
}));

// Media attachments — portraits/photos for characters, places, and physical-base types.
// Base kinds without media support (e.g. abstract) never create rows here.
export const media = pgTable('media', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  role: text('role').notNull(),   // 'portrait' | 'gallery'
  caption: text('caption'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Facts (atomic story facts with confidence)
export const facts = pgTable('facts', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  entityId: uuid('entity_id').references(() => entities.id),  // nullable for global facts
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  objectValue: text('object_value'),
  confidence: confidenceEnum('confidence').notNull(),
  provenanceDictationId: uuid('provenance_dictation_id').references(() => dictations.id),
  provenanceText: text('provenance_text'),  // exact transcript chunk
  supersededBy: uuid('superseded_by'),  // FK to another fact that replaced this one
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Events (event-centric model) — entity refs are generic across ALL entity types
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  settingId: uuid('setting_id').references(() => entities.id),  // where it happens (a room, a planet, a starship deck...)
  whenRaw: text('when_raw'),  // e.g. "October 14, 11:48 PM"
  whenNormalized: jsonb('when_normalized').$type<{ chapter?: string; day?: string; hour?: string; order: number }>(),
  motivation: text('motivation'),
  consequences: jsonb('consequences').$type<string[]>(),
  knowledgeGained: jsonb('knowledge_gained').$type<string[]>(),
  knowledgeConcealed: jsonb('knowledge_concealed').$type<string[]>(),
  participants: jsonb('participants').$type<string[]>(),  // entity IDs of any type
  involvedObjects: jsonb('involved_objects').$type<string[]>(),  // entity IDs of any type
  confidence: confidenceEnum('confidence').notNull(),
  provenanceDictationId: uuid('provenance_dictation_id').references(() => dictations.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relationships
export const relationships = pgTable('relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  fromEntityId: uuid('from_entity_id').notNull().references(() => entities.id),
  toEntityId: uuid('to_entity_id').notNull().references(() => entities.id),
  kind: text('kind').notNull(),  // e.g. "told", "loves", "betrayed", "knows"
  details: text('details'),
  confidence: confidenceEnum('confidence').notNull(),
  provenanceDictationId: uuid('provenance_dictation_id').references(() => dictations.id),
  supersededBy: uuid('superseded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Entity Knowledge (who/what knows what, when they learned it) — generalized to any entity type
export const entityKnowledge = pgTable('entity_knowledge', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  subjectEntityId: uuid('subject_entity_id').notNull().references(() => entities.id),
  factId: uuid('fact_id').references(() => facts.id),
  knowledgeText: text('knowledge_text').notNull(),
  status: knowledgeStatusEnum('status').notNull(),
  learnedWhen: text('learned_when'),  // chapter/timeline reference
  learnedVia: text('learned_via'),    // e.g. "overheard conversation"
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Scenes
export const scenes = pgTable('scenes', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  title: text('title'),
  settingId: uuid('setting_id').references(() => entities.id),
  whenRaw: text('when_raw'),
  whenNormalized: jsonb('when_normalized'),
  summary: text('summary'),
  chapterNumber: integer('chapter_number'),
  eventIds: jsonb('event_ids').$type<string[]>(),
  participantIds: jsonb('participant_ids').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Plot Threads
export const plotThreads = pgTable('plot_threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: plotThreadStatusEnum('status').default('introduced').notNull(),
  introducedInSceneId: uuid('introduced_in_scene_id').references(() => scenes.id),
  lastMentionedInSceneId: uuid('last_mentioned_in_scene_id').references(() => scenes.id),
  relatedEntityIds: jsonb('related_entity_ids').$type<string[]>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Open Questions
export const openQuestions = pgTable('open_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  relatedEntityIds: jsonb('related_entity_ids').$type<string[]>(),
  introducedInDictationId: uuid('introduced_in_dictation_id').references(() => dictations.id),
  resolvedInDictationId: uuid('resolved_in_dictation_id').references(() => dictations.id),
  isResolved: integer('is_resolved').default(0),  // 0=false, 1=true
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Contradictions (detected conflicts between facts)
export const contradictions = pgTable('contradictions', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  existingFactId: uuid('existing_fact_id').references(() => facts.id),
  newFactDescription: text('new_fact_description').notNull(),
  existingFactDescription: text('existing_fact_description').notNull(),
  action: contradictionActionEnum('action'),
  resolved: integer('resolved').default(0),
  resolvedByOwnerId: text('resolved_by_owner_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Embeddings (for semantic search via pgvector)
export const embeddings = pgTable('embeddings', {
  id: uuid('id').defaultRandom().primaryKey(),
  storyId: uuid('story_id').notNull().references(() => stories.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),  // "dictation", "entity", "event", "fact"
  entityId: uuid('entity_id').notNull(),
  chunkText: text('chunk_text').notNull(),
  // Vector stored as raw array; pgvector extension handles the column type
  // We'll use a raw SQL column for the vector
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Processing Jobs (for tracking background extraction)
export const processingJobs = pgTable('processing_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  dictationId: uuid('dictation_id').notNull().references(() => dictations.id),
  storyId: uuid('story_id').notNull().references(() => stories.id),
  status: jobStatusEnum('status').default('pending').notNull(),
  tier: text('tier'),  // which LLM tier was used
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  proposalData: jsonb('proposal_data'),  // raw StoryChangeProposal JSON
  resultSummary: jsonb('result_summary'),  // counts of what was added/changed
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

---

## 5. Domain Types (Pure TypeScript)

### 5.1 Story World Aggregate

```typescript
// src/core/domain/story-world.ts

import { z } from 'zod';

// --- Confidence & Provenance ---

export const ConfidenceSchema = z.enum(['explicit', 'implied', 'inferred', 'unknown']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ProvenanceSchema = z.object({
  dictationId: z.string().uuid(),
  textChunk: z.string(),
  confidence: ConfidenceSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

// --- Entities (dynamic: registry-driven, no fixed character/location/object union) ---

export const AttributeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type AttributeValue = z.infer<typeof AttributeValueSchema>;

export const AttributeKindSchema = z.enum(['text', 'number', 'boolean', 'enum', 'ref', 'timeline']);
export type AttributeKind = z.infer<typeof AttributeKindSchema>;

export const AttributeDefSchema = z.object({
  key: z.string(),                        // e.g. "goals", "armament", "captain"
  label: z.string(),                      // human-readable, e.g. "Armament"
  kind: AttributeKindSchema,              // "ref" links to another entity type
  required: z.boolean().default(false),
  multi: z.boolean().default(false),      // array-valued (text/number/enum/ref only)
  enumValues: z.array(z.string()).optional(),  // when kind === 'enum'
  refType: z.string().optional(),              // when kind === 'ref': target entity type name
});
export type AttributeDef = z.infer<typeof AttributeDefSchema>;

// --- Base kinds: system-level taxonomy that drives capabilities ---
// 'character' and 'place' are CORE — present in every story, with dedicated flows
// (portrait upload, character sheet, place card). 'physical' covers concrete things
// (starships, items) and supports image attachments; 'abstract' (factions, concepts)
// is text-only. The catalog is data in src/domain/base-kinds.ts.
export const EntityBaseKindSchema = z.enum(['character', 'place', 'physical', 'abstract']);
export type EntityBaseKind = z.infer<typeof EntityBaseKindSchema>;

export const BASE_KIND_CATALOG: Record<EntityBaseKind, {
  label: string;
  supportsMedia: boolean;  // images/photos can be attached
  isCore: boolean;         // guaranteed present in every story, cannot be deleted
}> = {
  character: { label: 'Character', supportsMedia: true, isCore: true },
  place:     { label: 'Place',     supportsMedia: true, isCore: true },
  physical:  { label: 'Physical instance', supportsMedia: true, isCore: false },
  abstract:  { label: 'Abstract',  supportsMedia: false, isCore: false },
};

export const EntityTypeSchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid().nullable().default(null),  // null = shared builtin/preset template
  name: z.string(),                                     // stable key, e.g. "character" | "starship"
  pluralName: z.string(),                               // "characters" | "starships"
  baseKind: EntityBaseKindSchema,                       // inherits capabilities from the base kind
  description: z.string().nullable().default(null),
  attributeDefs: z.array(AttributeDefSchema).default([]),
  origin: z.enum(['core', 'preset', 'extracted', 'user']),
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const MediaRefSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  role: z.enum(['portrait', 'gallery']),
  caption: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const EntitySchema = z.object({
  id: z.string().uuid(),
  storyId: z.string().uuid(),
  entityTypeId: z.string().uuid(),       // ref into the story's entity-type registry
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),  // validated against the type's attributeDefs
  media: z.array(MediaRefSchema).default([]),  // allowed only when baseKind.supportsMedia
  createdAt: z.date(),
});
export type Entity = z.infer<typeof EntitySchema>;

// --- Fact ---

export const FactSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  predicate: z.string(),
  objectValue: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type Fact = z.infer<typeof FactSchema>;

// --- Event ---

export const TimelineRefSchema = z.object({
  raw: z.string(),
  normalized: z.object({
    chapter: z.string().optional(),
    day: z.string().optional(),
    hour: z.string().optional(),
    order: z.number(),
  }).optional(),
});
export type TimelineRef = z.infer<typeof TimelineRefSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().default(null),
  settingId: z.string().uuid().nullable().default(null),    // ref to ANY entity (room, planet, starship deck...)
  when: TimelineRefSchema.nullable().default(null),
  motivation: z.string().nullable().default(null),
  consequences: z.array(z.string()).default([]),
  knowledgeGained: z.array(z.string()).default([]),
  knowledgeConcealed: z.array(z.string()).default([]),
  participants: z.array(z.string().uuid()).default([]),      // entity IDs of any type
  involvedObjects: z.array(z.string().uuid()).default([]),   // entity IDs of any type
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  createdAt: z.date(),
});
export type StoryEvent = z.infer<typeof EventSchema>;

// --- Relationship ---

export const RelationshipSchema = z.object({
  id: z.string().uuid(),
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  kind: z.string(),
  details: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

// --- Character Knowledge ---

export const EntityKnowledgeSchema = z.object({
  id: z.string().uuid(),
  subjectEntityId: z.string().uuid(),    // any entity that can know things (character, AI, animal…)
  factId: z.string().uuid().nullable().default(null),
  knowledgeText: z.string(),
  status: z.enum(['known', 'unknown', 'believed_true', 'believed_false']),
  learnedWhen: z.string().nullable().default(null),
  learnedVia: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type EntityKnowledge = z.infer<typeof EntityKnowledgeSchema>;

// --- Scene ---

export const SceneSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable().default(null),
  settingId: z.string().uuid().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  summary: z.string().nullable().default(null),
  chapterNumber: z.number().nullable().default(null),
  eventIds: z.array(z.string().uuid()).default([]),
  participantIds: z.array(z.string().uuid()).default([]),
  createdAt: z.date(),
});
export type Scene = z.infer<typeof SceneSchema>;

// --- Plot Thread ---

export const PlotThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable().default(null),
  status: z.enum(['introduced', 'active', 'resolved', 'abandoned']),
  introducedInSceneId: z.string().uuid().nullable().default(null),
  lastMentionedInSceneId: z.string().uuid().nullable().default(null),
  relatedEntityIds: z.array(z.string().uuid()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PlotThread = z.infer<typeof PlotThreadSchema>;

// --- Open Question ---

export const OpenQuestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  relatedEntityIds: z.array(z.string().uuid()).default([]),
  introducedInDictationId: z.string().uuid().nullable().default(null),
  resolvedInDictationId: z.string().uuid().nullable().default(null),
  isResolved: z.boolean().default(false),
  createdAt: z.date(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

// --- Story World (root aggregate) ---

export interface StoryWorld {
  id: string;
  title: string;
  synopsis: string | null;
  storyType: string | null;        // e.g. "space-opera" — selects preset entity types at creation
  entityTypes: EntityType[];       // the entity-type registry for this story (dynamic)
  entities: Entity[];
  facts: Fact[];
  events: StoryEvent[];
  relationships: Relationship[];
  knowledge: EntityKnowledge[];
  scenes: Scene[];
  plotThreads: PlotThread[];
  openQuestions: OpenQuestion[];
}
```

### 5.2 Story Change Proposal (what the LLM returns)

```typescript
// src/core/domain/proposals.ts

import { z } from 'zod';
import { ConfidenceSchema, TimelineRefSchema } from './story-world';

// --- Extraction Schemas (what the LLM outputs) ---
// The LLM is NOT restricted to characters/locations/objects. It can propose new
// entity types (with attribute definitions) and then entities of those types.

export const ProposedAttributeDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: AttributeKindSchema,
  required: z.boolean().default(false),
  multi: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
  refType: z.string().optional(),
});

export const ProposedEntityTypeSchema = z.object({
  name: z.string(),                                   // "starship"
  pluralName: z.string(),                             // "starships"
  baseKind: EntityBaseKindSchema,                     // 'physical' | 'abstract' | 'place' — drives capabilities
  description: z.string().nullable().default(null),
  attributeDefs: z.array(ProposedAttributeDefSchema).default([]),
});

export const ProposedEntitySchema = z.object({
  entityTypeName: z.string(),   // must reference an existing OR concurrently-proposed type
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),
});

export const ProposedEventSchema = z.object({
  title: z.string(),
  description: z.string().nullable().default(null),
  settingName: z.string().nullable().default(null),   // any entity: "Old House", "starship bridge", "The Oasis Moon"
  when: TimelineRefSchema.nullable().default(null),
  motivation: z.string().nullable().default(null),
  consequences: z.array(z.string()).default([]),
  knowledgeGained: z.array(z.string()).default([]),
  knowledgeConcealed: z.array(z.string()).default([]),
  participantNames: z.array(z.string()).default([]),  // entity names of any type
  involvedObjectNames: z.array(z.string()).default([]), // entity names of any type
  confidence: ConfidenceSchema,
});

export const ProposedRelationshipSchema = z.object({
  fromEntityName: z.string(),   // any entity
  toEntityName: z.string(),     // any entity
  kind: z.string(),
  details: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
});

export const ProposedFactSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  objectValue: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
});

export const ProposedKnowledgeSchema = z.object({
  subjectEntityName: z.string(),  // any entity that can know things
  knowledgeText: z.string(),
  status: z.enum(['known', 'unknown', 'believed_true', 'believed_false']),
  learnedWhen: z.string().nullable().default(null),
  learnedVia: z.string().nullable().default(null),
});

export const ProposedSceneSchema = z.object({
  title: z.string().nullable().default(null),
  settingName: z.string().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  summary: z.string().nullable().default(null),
  chapterNumber: z.number().nullable().default(null),
  participantNames: z.array(z.string()).default([]),
});

export const ProposedPlotThreadSchema = z.object({
  title: z.string(),
  description: z.string().nullable().default(null),
  status: z.enum(['introduced', 'active', 'resolved', 'abandoned']),
  relatedEntityNames: z.array(z.string()).default([]),
});

// The main proposal schema — what the extraction LLM must output
export const StoryChangeProposalSchema = z.object({
  entityTypes: z.array(ProposedEntityTypeSchema).default([]),  // new entity types to register
  entities: z.array(ProposedEntitySchema).default([]),         // entities of any (existing or new) type
  events: z.array(ProposedEventSchema).default([]),
  relationships: z.array(ProposedRelationshipSchema).default([]),
  facts: z.array(ProposedFactSchema).default([]),
  knowledge: z.array(ProposedKnowledgeSchema).default([]),
  scenes: z.array(ProposedSceneSchema).default([]),
  plotThreads: z.array(ProposedPlotThreadSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  contradictions: z.array(z.object({
    existingFactDescription: z.string(),
    newFactDescription: z.string(),
    recommendedAction: z.enum(['supersede', 'flag_soft', 'flag_hard', 'ignore']),
  })).default([]),
});

export type StoryChangeProposal = z.infer<typeof StoryChangeProposalSchema>;
```

### 5.3 Entity Type Registry, Core Types & Base Kinds

The entity model has **two tiers**:

**Tier 1 — Core types (guaranteed in every story, designed explicitly).** `character` and `place` always exist, cannot be deleted, and carry the specialized flows: portrait/photo upload, the **character sheet**, the **place card**, and the **relationship graph** (relationships are also core — first-class edges between any two entities, with a dedicated UI). Because they are registry entries (attribute definitions are data), even these core types remain extensible — you can add attribute defs to `character` — but their existence and their specialized flows are guaranteed.

**Tier 2 — Dynamic types (everything else).** New entity types are created by the user (via the UI/API), chosen via a story-type preset, or proposed by the extraction LLM. Every dynamic type derives from a **base kind** (`base-kinds.ts`), a small system-level taxonomy that determines capabilities:

| Base kind | Media (images) | Examples |
|---|---|---|
| `character` ⭐ core | ✅ portrait + gallery | Sarah, Aria Voss |
| `place` ⭐ core | ✅ photos | The Oasis Moon, Old House |
| `physical` | ✅ gallery (no portrait) | starship, brass key, faction HQ |
| `abstract` | ❌ text only | a faction, a prophecy, an organization |

Seeds every story starts with (data in `src/domain/builtins.ts`):

```jsonc
{
  "name": "character", "pluralName": "characters", "baseKind": "character", "origin": "core",
  "attributeDefs": [
    { "key": "nickname", "label": "Nickname" },
    { "key": "goals", "label": "Goals", "kind": "text", "multi": true },
    { "key": "fears", "label": "Fears", "kind": "text", "multi": true },
    { "key": "desires", "label": "Desires", "kind": "text", "multi": true },
    { "key": "beliefs", "label": "Beliefs", "kind": "text", "multi": true },
    { "key": "secrets", "label": "Secrets", "kind": "text", "multi": true },
    { "key": "appearance", "label": "Appearance", "kind": "text", "multi": true },
    { "key": "personality", "label": "Personality", "kind": "text", "multi": true },
    { "key": "backstory", "label": "Backstory" }
  ]
}
// "place"  → baseKind "place",  origin "core"   — description, climate, notable-features...
// "object" → baseKind "physical", origin "core" — significance (convenience seed; users can add more physical types)
```

**Story-type presets.** A story created with `storyType: "space-opera"` additionally seeds `starship` (baseKind `physical`), `planet` (baseKind `place`), `faction` (baseKind `abstract`), and more. Presets are plain data in `src/domain/story-types.ts`; adding a story type means adding an entry, not touching logic.

**Extraction discovers more.** The LLM can propose brand-new types in every dictation — it just picks a sensible baseKind. Example — the writer dictates:

> "The *Relentless* is a Falcon-class cruiser, armed with twin ion cannons and captained by Aria Voss. The two ships exchanged fire over the Oasis Moon."

The LLM returns a proposal containing:

```jsonc
{
  "entityTypes": [
    {
      "name": "starship", "pluralName": "starships", "baseKind": "physical", "origin": "extracted",
      "attributeDefs": [
        { "key": "class", "label": "Class", "kind": "enum", "enumValues": ["Falcon", "Battlestar", "Freighter"] },
        { "key": "armament", "label": "Armament", "kind": "text", "multi": true },
        { "key": "captain", "label": "Captain", "kind": "ref", "refType": "character" }
      ]
    }
  ],
  "entities": [
    { "entityTypeName": "starship", "name": "The Relentless", "attributes": { "class": "Falcon", "armament": ["twin ion cannons"], "captain": "Aria Voss" } }
  ],
  "events": [
    { "title": "The Relentless and her adversary trade fire", "settingName": "The Oasis Moon", "participantNames": ["The Relentless"], "confidence": "explicit" }
  ]
}
```

The pipeline registers `starship` (baseKind `physical` → image uploads become available in the UI), validates `The Relentless`'s attributes against it, resolves `Aria Voss` (existing character → same `character` entity), and commits. Facts, events, relationships, scenes, knowledge — all reference entities **generically by ID**, so nothing else needs to know a starship exists.

**Consequences for the rest of the system:**

- The entity **resolver** uses a single name/alias → entity-ID map across all types (no per-type loops).
- The **context builder** never branches on entity type — it renders whatever attributes the type declares.
- The **UI** is schema-driven for everything except the core flows: lists, sheets, and cards render from `attributeDefs`; media controls appear only when `baseKind.supportsMedia`; the sidebar shows core sections (Characters, Places, Relationships) plus dynamic sections derived from the registry ("Starships", "Factions", …).
- **Media** (images) is stored per entity (`media` table / `Entity.media`) and only for bases with `supportsMedia`; committing media to an `abstract`-base entity is rejected.
- `CommitResult` reports per-entity-type counts so the "What changed?" card can say *"Added: 2 starships, 3 events…"*.

---

## 6. Container Registry — Port Contracts (ioctopus tokens)

### 6.1 Speech-to-Text Port

```typescript
// src/container/stt.ts

export interface SpeechToText {
  /**
   * Submit audio for transcription.
   * Returns a job ID that can be polled or used with a webhook callback.
   */
  submitTranscription(params: {
    audioBuffer: Buffer;
    mimeType: string;
    webhookUrl?: string;  // AssemblyAI calls this when done
  }): Promise<{ jobId: string }>;

  /**
   * Check the status of a transcription job.
   */
  getJobStatus(jobId: string): Promise<{
    status: 'queued' | 'processing' | 'completed' | 'failed';
    transcript?: string;
    error?: string;
  }>;
}
```

### 6.2 LLM Port

```typescript
// src/container/llm.ts

import { StoryChangeProposal } from '../domain/proposals';

export type LLMTier = 'cheap' | 'standard' | 'best';

export interface LlmClient {
  /**
   * Generate text completion (used for analysis, chat, etc.)
   */
  complete(params: {
    tier: LLMTier;
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;

  /**
   * Extract structured data from transcript.
   * Returns a validated StoryChangeProposal or an error.
   */
  extractProposal(params: {
    tier: LLMTier;
    systemPrompt: string;
    userMessage: string;
    schema: 'story_change_proposal';  // for future extensibility
  }): Promise<{ proposal: StoryChangeProposal; usage: { inputTokens: number; outputTokens: number } }>;
}
```

### 6.3 Story World Store Port

```typescript
// src/container/story-world-store.ts

import { StoryWorld, Entity, EntityType, Fact, StoryEvent, Relationship, EntityKnowledge, Scene, PlotThread, OpenQuestion } from '../domain/story-world';

export interface StoryWorldStore {
  // Story CRUD
  getStory(storyId: string): Promise<StoryWorld>;
  listStories(ownerId: string): Promise<{ id: string; title: string; updatedAt: Date }[]>;
  createStory(params: { title: string; synopsis?: string; ownerId: string; storyType?: string }): Promise<string>;
  deleteStory(storyId: string): Promise<void>;

  // Entity-type registry operations (the dynamic entity model)
  upsertEntityType(storyId: string, def: Omit<EntityType, 'id' | 'createdAt'>): Promise<string>;
  getEntityTypes(storyId: string): Promise<EntityType[]>;
  findEntityTypeByName(storyId: string, name: string): Promise<EntityType | null>;

  // Entity operations — type-agnostic. No per-kind methods, ever.
  upsertEntity(storyId: string, entity: Omit<Entity, 'id'>): Promise<string>;  // returns ID
  getEntity(storyId: string, entityId: string): Promise<Entity | null>;
  findEntityByName(storyId: string, name: string): Promise<Entity | null>;     // matches name + aliases across ALL types
  listEntities(storyId: string, entityTypeId?: string): Promise<Entity[]>;     // filter by registry type when given

  // Media operations (only for base kinds with supportsMedia)
  attachMedia(entityId: string, media: Omit<MediaRef, 'id' | 'createdAt'>): Promise<string>;  // returns media ID
  getMedia(entityId: string): Promise<MediaRef[]>;

  // Fact operations
  insertFact(storyId: string, fact: Omit<Fact, 'id' | 'createdAt'>): Promise<string>;
  getFacts(storyId: string, entityId?: string): Promise<Fact[]>;
  supersedeFact(factId: string, supersededById: string): Promise<void>;

  // Event operations
  insertEvent(storyId: string, event: Omit<StoryEvent, 'id' | 'createdAt'>): Promise<string>;
  getEvents(storyId: string, params?: { entityId?: string; limit?: number; offset?: number }): Promise<StoryEvent[]>;

  // Relationship operations
  insertRelationship(storyId: string, rel: Omit<Relationship, 'id' | 'createdAt'>): Promise<string>;
  getRelationships(storyId: string, entityId?: string): Promise<Relationship[]>;
  supersedeRelationship(relId: string, supersededById: string): Promise<void>;

  // Entity Knowledge operations (generalized: any entity can "know")
  insertKnowledge(storyId: string, k: Omit<EntityKnowledge, 'id' | 'createdAt'>): Promise<string>;
  getKnowledge(storyId: string, subjectEntityId: string): Promise<EntityKnowledge[]>;

  // Scene operations
  insertScene(storyId: string, scene: Omit<Scene, 'id' | 'createdAt'>): Promise<string>;
  getScenes(storyId: string): Promise<Scene[]>;

  // Plot Thread operations
  upsertPlotThread(storyId: string, pt: Omit<PlotThread, 'id' | 'createdAt' | 'updatedAt'>): Promise<string>;
  getPlotThreads(storyId: string): Promise<PlotThread[]>;

  // Open Question operations
  insertOpenQuestion(storyId: string, oq: Omit<OpenQuestion, 'id' | 'createdAt'>): Promise<string>;
  getOpenQuestions(storyId: string, onlyUnresolved?: boolean): Promise<OpenQuestion[]>;
  resolveOpenQuestion(oqId: string, resolvedInDictationId: string): Promise<void>;

  // Contradiction operations
  insertContradiction(params: {
    storyId: string;
    existingFactId?: string;
    newFactDescription: string;
    existingFactDescription: string;
  }): Promise<string>;
}
```

### 6.4 Transcript Store Port

```typescript
// src/container/transcript-store.ts

export interface TranscriptStore {
  saveDictation(params: {
    storyId: string;
    userId: string;           // owning user (multi-tenant)
    audioUrl?: string;
    providerJobId?: string;   // AssemblyAI transcript_id
    transcript?: string;
    wordCount?: number;
    durationSeconds?: number;
    status: 'pending' | 'processing' | 'completed' | 'failed';
  }): Promise<string>;

  getDictation(dictationId: string): Promise<{
    id: string;
    storyId: string;
    userId: string;
    audioUrl: string | null;
    transcript: string | null;
    wordCount: number | null;
    status: string;
    createdAt: Date;
  } | null>;

  // Callback correlation: the only identifier the STT webhook carries is the
  // provider job id. Resolve it here so the handler learns userId/storyId from
  // the DB row — never from the webhook URL or body.
  findDictationByProviderJobId(providerJobId: string): Promise<{
    id: string;
    storyId: string;
    userId: string;
    status: string;
  } | null>;

  updateDictation(dictationId: string, updates: {
    providerJobId?: string;
    transcript?: string;
    wordCount?: number;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    processedAt?: Date;
  }): Promise<void>;

  listDictations(params: { storyId: string; userId?: string }): Promise<Array<{
    id: string;
    transcript: string | null;
    wordCount: number | null;
    status: string;
    createdAt: Date;
  }>>;
}
```

### 6.5 Job Queue Port

```typescript
// src/container/job-queue.ts

// Provider-agnostic: production adapter is AWS SQS (fully managed), dev/test uses
// the in-memory adapter. SQS has no server-side rate limiter, so production wiring
// bounds the consumer's maxConcurrency to stay under AssemblyAI's account rate limit.
export interface JobQueue {
  enqueue<T>(jobName: string, data: T): Promise<{ jobId: string }>;
  onJobCompleted(jobName: string, handler: (data: any) => Promise<void>): void;
  onJobFailed(jobName: string, handler: (data: any, error: Error) => Promise<void>): void;
}
```

### 6.6 Embedding / Vector Store Port

```typescript
// src/container/semantic-store.ts

export interface EmbeddingStore {
  upsert(params: {
    storyId: string;
    entityType: string;
    entityId: string;
    chunkText: string;
    embedding: number[];
  }): Promise<string>;

  search(params: {
    storyId: string;
    queryEmbedding: number[];
    topK: number;
    entityTypes?: string[];
  }): Promise<Array<{
    entityId: string;
    entityType: string;
    chunkText: string;
    score: number;
  }>>;

  deleteByEntity(entityType: string, entityId: string): Promise<void>;
}
```

---

## 7. Infrastructure — Composition Root (@evyweb/ioctopus)

Port contracts (the abstraction) are declared in `src/container/*.ts`. Adapters are wired against those contracts through the **ioctopus container**: a typed `AppRegistry` maps each injection token to its contract, so `container.get('...')` resolves with full type safety and no casts. There is no hand-rolled `ServiceContainer` type and no separate DI barrel — the IoC container *is* the abstraction boundary.

```typescript
// src/container/registry.ts
import { AppConfig } from '../config';
import { LlmClient } from './llm';
import { SpeechToText } from './stt';
import { StoryWorldStore } from './story-world-store';
import { TranscriptStore } from './transcript-store';
import { SemanticStore } from './semantic-store';
import { JobQueue } from './job-queue';
import { Clock } from './clock';

export type AppRegistry = {
  CONFIG: AppConfig;
  STT: SpeechToText;
  LLM: LlmClient;
  STORY_WORLD_STORE: StoryWorldStore;
  TRANSCRIPT_STORE: TranscriptStore;
  SEMANTIC_STORE: SemanticStore;
  JOB_QUEUE: JobQueue;
  CLOCK: Clock;
};
```

```typescript
// src/container/index.ts
import { createContainer, createModule } from '@evyweb/ioctopus';
import type { TypedContainer } from '@evyweb/ioctopus';
import { loadConfig } from '../config';
import type { AppRegistry } from './registry';

export type Container = TypedContainer<AppRegistry>;

export function createAppModule() {
  const module = createModule<AppRegistry>();
  module.bind('CONFIG').toValue(loadConfig());
  return module;
}

// Production: pick adapters based on CONFIG and bind them to their tokens
export function buildContainer(): Container {
  const container = createContainer<AppRegistry>();
  container.load('app', createAppModule());
  container.bind('STT').toHigherOrderFunction(makeStt, ['CONFIG']);
  container.bind('LLM').toHigherOrderFunction(makeLlm, ['CONFIG']);
  container.bind('STORY_WORLD_STORE').toHigherOrderFunction(makeStoryWorldStore, ['CONFIG']);
  container.bind('TRANSCRIPT_STORE').toHigherOrderFunction(makeTranscriptStore, ['CONFIG']);
  container.bind('SEMANTIC_STORE').toHigherOrderFunction(makeSemanticStore, ['CONFIG']);
  container.bind('JOB_QUEUE').toHigherOrderFunction(makeJobQueue, ['CONFIG']);
  container.bind('CLOCK').toFunction(systemClock);
  return container;
}

// Tests/dev: bind the in-memory adapters instead
export function buildMemoryContainer(): Container {
  const container = createContainer<AppRegistry>();
  container.load('app', createAppModule());
  container.bind('STT').toHigherOrderFunction(mockStt);
  container.bind('LLM').toHigherOrderFunction(mockLlm);
  container.bind('STORY_WORLD_STORE').toHigherOrderFunction(mockStoryWorldStore);
  // ...
  return container;
}

// Resolving is fully typed — no casts required
const stt = container.get('STT');   // SpeechToText
const store = container.get('STORY_WORLD_STORE');  // StoryWorldStore
```

> In the §8+ application examples, `container.stt` / `container.llm` / `container.store` / `container.transcriptStore` / `container.queue` / `container.embeddings` are shorthand for `container.get('STT')` / `container.get('LLM')` / `container.get('STORY_WORLD_STORE')` / `container.get('TRANSCRIPT_STORE')` / `container.get('JOB_QUEUE')` / `container.get('SEMANTIC_STORE')`.

---

---

## 8. Application Services

### 8.1 Extraction Pipeline (the core orchestrator)

```typescript
// src/application/extraction/extract-entities.ts

import type { Container } from '../../container';
import { StoryChangeProposalSchema, StoryChangeProposal } from '../../core/domain/proposals';

const EXTRACTION_SYSTEM_PROMPT = `You are an expert narrative analyst. Given a transcript from a novelist's dictation, extract structured story data.

IMPORTANT RULES:
1. Only extract what is EXPLICITLY stated or STRONGLY implied in the text.
2. For every extracted fact, classify its confidence:
   - "explicit": directly stated in the text
   - "implied": strongly suggested but not directly stated
   - "inferred": your interpretation (flag it as such)
3. Output valid JSON matching the provided schema.
4. If the text contains contradictions with previously known facts, list them in the contradictions array.
5. Track what each entity KNOWS (not just characters — an AI, a faction, a sentient starship can all "know" things) vs what is merely true in the story world.
6. If you encounter a recurring type of thing that is NOT already in the story's existing entity types (e.g. starships, alien species, factions), propose a new entity type in the `entityTypes` array with appropriate attribute definitions, then tag the relevant entities with that type.
7. Identify open questions the writer has left unanswered.

You are NOT writing the story. You are building a structured knowledge representation of the narrator's dictation.`;

export async function extractFromTranscript(
  container: Container,
  params: {
    transcript: string;
    storyId: string;
    existingContext: string;  // relevant existing entities/events for context
  }
): Promise<{ proposal: StoryChangeProposal; usage: { inputTokens: number; outputTokens: number } }> {
  const userMessage = buildExtractionPrompt(params.transcript, params.existingContext);

  const result = await container.llm.extractProposal({
    tier: 'cheap',  // high-volume extraction uses cheap tier
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    schema: 'story_change_proposal',
  });

  return result;
}

function buildExtractionPrompt(transcript: string, existingContext: string): string {
  return `## Existing Story Context
${existingContext || '(No existing context — this appears to be the first dictation.)'}

## New Transcript to Analyze
${transcript}

## Instructions
Extract all story elements from the transcript above. For each entity, determine the appropriate confidence level. If you detect any contradictions with the existing context, list them in the contradictions array.`;
}
```

### 8.2 Context Builder (Selective Retrieval)

```typescript
// src/application/context/context-builder.ts

import type { Container } from '../../container';

export interface RelevantContext {
  entityTypes: Array<{ name: string; pluralName: string; attributeDefs: AttributeDef[] }>;
  entities: Array<{ id: string; entityType: string; name: string; aliases: string[]; attributes: Record<string, AttributeValue> }>;
  recentEvents: Array<{ title: string; description: string | null; participants: string[] }>;
  relationships: Array<{ from: string; to: string; kind: string; details: string | null }>;
  openQuestions: string[];
  // Token budget used so far (approximate)
  tokenEstimate: number;
}

const TOKEN_BUDGET = 3000;  // keep context under ~3k tokens for extraction

export async function buildRelevantContext(
  container: Container,
  params: {
    storyId: string;
    transcriptChunk: string;
  }
): Promise<RelevantContext> {
  const { storyId, transcriptChunk } = params;

  // Step 1: Extract mentioned names from the transcript using cheap LLM
  const mentionedNames = await extractMentionedNames(container, transcriptChunk);

  // Fetch the story's entity-type registry (to translate type IDs → names for the context)
  const entityTypes = await container.store.getEntityTypes(storyId);
  const typeNamesById = new Map(entityTypes.map(t => [t.id, t.name]));

  // Step 2: Resolve names to entity IDs — works for ANY entity type
  const resolvedEntities: RelevantContext['entities'] = [];

  for (const name of mentionedNames) {
    const entity = await container.store.findEntityByName(storyId, name);
    if (entity) {
      resolvedEntities.push({
        id: entity.id,
        entityType: typeNamesById.get(entity.entityTypeId) ?? 'unknown',
        name: entity.name,
        aliases: entity.aliases,
        attributes: entity.attributes,
      });
    }
  }

  // Step 3: Fetch relationships for resolved entities (any type)
  const entityIds = resolvedEntities.map(e => e.id);
  const relationships = await container.store.getRelationships(storyId);
  const relevantRelationships = relationships.filter(
    r => entityIds.includes(r.fromEntityId) || entityIds.includes(r.toEntityId)
  );

  // Step 4: Fetch recent events (last 10)
  const recentEvents = await container.store.getEvents(storyId, { limit: 10 });

  // Step 5: Fetch open questions
  const openQuestions = await container.store.getOpenQuestions(storyId, true);

  // Step 6: Fetch semantic matches via vector search
  const embedding = await getEmbedding(container, transcriptChunk);
  const semanticMatches = await container.embeddings.search({
    storyId,
    queryEmbedding: embedding,
    topK: 5,
  });

  // Step 7: Estimate tokens and trim if needed
  const context: RelevantContext = {
    entityTypes: entityTypes.map(t => ({ name: t.name, pluralName: t.pluralName, attributeDefs: t.attributeDefs })),
    entities: resolvedEntities,
    recentEvents: recentEvents.map(e => ({
      title: e.title,
      description: e.description,
      participants: e.participants,
    })),
    relationships: relevantRelationships.map(r => ({
      from: r.fromEntityId,
      to: r.toEntityId,
      kind: r.kind,
      details: r.details,
    })),
    openQuestions: openQuestions.map(oq => oq.question),
    tokenEstimate: 0,
  };

  context.tokenEstimate = estimateTokens(context);
  return context;
}

async function extractMentionedNames(container: Container, text: string): Promise<string[]> {
  const result = await container.llm.complete({
    tier: 'cheap',
    systemPrompt: 'Extract the names of every story entity mentioned in the text (characters, places, ships, factions, objects, ...). Return only a JSON array of strings.',
    userMessage: text,
    maxTokens: 200,
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return [];
  }
}

async function getEmbedding(container: Container, text: string): Promise<number[]> {
  // Placeholder — in production, call OpenAI embedding API
  return [];
}

function estimateTokens(context: RelevantContext): number {
  // Rough estimation: ~4 chars per token
  const json = JSON.stringify(context);
  return Math.ceil(json.length / 4);
}
```

### 8.3 Proposal Resolution & Commit

```typescript
// src/application/extraction/resolve-proposals.ts

import type { Container } from '../../container';
import { StoryChangeProposal } from '../../core/domain/proposals';
import { Entity } from '../../core/domain/story-world';
import { randomUUID } from 'crypto';

export interface ResolvedProposal extends StoryChangeProposal {
  _resolvedEntities: Map<string, string>;    // name/alias → entityId — ALL types in ONE map
  _resolvedEntityTypes: Map<string, string>; // entityTypeName → entityTypeId (for newly registered types)
}

/**
 * Register any proposed brand-new entity types, then resolve every proposed entity's
 * name/alias to an existing entity ID — across ALL entity types via a single map.
 * New entities get fresh UUIDs.
 * Ambiguous matches are flagged for standard-tier review.
 */
export async function resolveProposals(
  container: Container,
  storyId: string,
  proposal: StoryChangeProposal
): Promise<ResolvedProposal> {
  const resolvedEntityTypes = new Map<string, string>();

  // 0. Register proposed brand-new entity types first (e.g. "starship")
  for (const type of proposal.entityTypes) {
    const existing = await container.store.findEntityTypeByName(storyId, type.name);
    const typeId = existing
      ? existing.id
      : await container.store.upsertEntityType(storyId, {
          storyId,
          name: type.name,
          pluralName: type.pluralName,
          baseKind: type.baseKind,
          description: type.description,
          attributeDefs: type.attributeDefs,
          origin: 'extracted',
          supersededBy: null,
        });
    resolvedEntityTypes.set(type.name, typeId);
  }

  const resolvedEntities = new Map<string, string>();

  // 1. Resolve every proposed entity (of ANY type), name/alias → entityId
  for (const entity of proposal.entities) {
    const existing = await container.store.findEntityByName(storyId, entity.name);
    if (existing) {
      resolvedEntities.set(entity.name, existing.id);
      continue;
    }
    let found = false;
    for (const alias of entity.aliases) {
      const byAlias = await container.store.findEntityByName(storyId, alias);
      if (byAlias) {
        resolvedEntities.set(entity.name, byAlias.id);
        found = true;
        break;
      }
    }
    if (!found) {
      resolvedEntities.set(entity.name, randomUUID());
    }
  }

  return {
    ...proposal,
    _resolvedEntities: resolvedEntities,
    _resolvedEntityTypes: resolvedEntityTypes,
  };
}
```

### 8.4 Commit Service

```typescript
// src/application/extraction/commit-proposals.ts

import type { Container } from '../../container';
import { ResolvedProposal } from './resolve-proposals';
import { randomUUID } from 'crypto';

export interface CommitResult {
  entityTypesCreated: number;                     // e.g. 1 → "starship"
  entitiesCreated: number;                        // total across all types
  entitiesCreatedByType: Record<string, number>;  // e.g. { character: 1, starship: 2 }
  eventsAdded: number;
  factsAdded: number;
  relationshipsAdded: number;
  knowledgeAdded: number;
  scenesAdded: number;
  plotThreadsUpdated: number;
  openQuestionsAdded: number;
  contradictionsFound: number;
  totalTokensUsed: { input: number; output: number };
}

export async function commitProposals(
  container: Container,
  params: {
    storyId: string;
    dictationId: string;
    resolved: ResolvedProposal;
    usage: { inputTokens: number; outputTokens: number };
  }
): Promise<CommitResult> {
  const { storyId, dictationId, resolved, usage } = params;
  const result: CommitResult = {
    entityTypesCreated: 0,
    entitiesCreated: 0,
    entitiesCreatedByType: {},
    eventsAdded: 0,
    factsAdded: 0,
    relationshipsAdded: 0,
    knowledgeAdded: 0,
    scenesAdded: 0,
    plotThreadsUpdated: 0,
    openQuestionsAdded: 0,
    contradictionsFound: 0,
    totalTokensUsed: { input: usage.inputTokens, output: usage.outputTokens },
  };

  // 1. New entity types were already registered during resolveProposals
  result.entityTypesCreated = resolved.entityTypes.length;

  // 2. Upsert entities of ANY type
  for (const entity of resolved.entities) {
    const entityId = resolved._resolvedEntities.get(entity.name)!;
    const entityTypeId = resolved._resolvedEntityTypes.get(entity.entityTypeName)
      ?? (await container.store.findEntityTypeByName(storyId, entity.entityTypeName))?.id;
    if (!entityTypeId) {
      throw new Error(`Proposed entity "${entity.name}" references unknown entity type "${entity.entityTypeName}"`);
    }
    await container.store.upsertEntity(storyId, {
      id: entityId,
      storyId,
      entityTypeId,
      name: entity.name,
      aliases: entity.aliases,
      attributes: entity.attributes,   // validated against the entity type's attributeDefs
    });
    result.entitiesCreated++;
    result.entitiesCreatedByType[entity.entityTypeName] =
      (result.entitiesCreatedByType[entity.entityTypeName] ?? 0) + 1;
  }

  // 3. Insert events
  for (const evt of resolved.events) {
    const participantIds = evt.participantNames
      .map(name => resolved._resolvedEntities.get(name))
      .filter(Boolean) as string[];

    const settingId = evt.settingName
      ? resolved._resolvedEntities.get(evt.settingName) ?? null
      : null;

    const objectIds = evt.involvedObjectNames
      .map(name => resolved._resolvedEntities.get(name))
      .filter(Boolean) as string[];

    await container.store.insertEvent(storyId, {
      id: randomUUID(),
      title: evt.title,
      description: evt.description,
      settingId,
      when: evt.when,
      motivation: evt.motivation,
      consequences: evt.consequences,
      knowledgeGained: evt.knowledgeGained,
      knowledgeConcealed: evt.knowledgeConcealed,
      participants: participantIds,
      involvedObjects: objectIds,
      confidence: evt.confidence,
      provenance: {
        dictationId,
        textChunk: evt.title,  // simplified
        confidence: evt.confidence,
      },
    });
    result.eventsAdded++;
  }

  // 4. Insert facts
  for (const fact of resolved.facts) {
    await container.store.insertFact(storyId, {
      id: randomUUID(),
      subject: fact.subject,
      predicate: fact.predicate,
      objectValue: fact.objectValue,
      confidence: fact.confidence,
      provenance: {
        dictationId,
        textChunk: `${fact.subject} ${fact.predicate} ${fact.objectValue ?? ''}`,
        confidence: fact.confidence,
      },
      supersededBy: null,
    });
    result.factsAdded++;
  }

  // 5. Insert relationships (between ANY entity types)
  for (const rel of resolved.relationships) {
    const fromId = resolved._resolvedEntities.get(rel.fromEntityName);
    const toId = resolved._resolvedEntities.get(rel.toEntityName);

    if (fromId && toId) {
      await container.store.insertRelationship(storyId, {
        id: randomUUID(),
        fromEntityId: fromId,
        toEntityId: toId,
        kind: rel.kind,
        details: rel.details,
        confidence: rel.confidence,
        provenance: {
          dictationId,
          textChunk: `${rel.fromEntityName} ${rel.kind} ${rel.toEntityName}`,
          confidence: rel.confidence,
        },
        supersededBy: null,
      });
      result.relationshipsAdded++;
    }
  }

  // 6. Insert knowledge (any entity can "know")
  for (const k of resolved.knowledge) {
    const subjectId = resolved._resolvedEntities.get(k.subjectEntityName);
    if (subjectId) {
      await container.store.insertKnowledge(storyId, {
        id: randomUUID(),
        subjectEntityId: subjectId,
        factId: null,
        knowledgeText: k.knowledgeText,
        status: k.status,
        learnedWhen: k.learnedWhen,
        learnedVia: k.learnedVia,
      });
      result.knowledgeAdded++;
    }
  }

  // 7. Insert scenes
  for (const scene of resolved.scenes) {
    const settingId = scene.settingName
      ? resolved._resolvedEntities.get(scene.settingName) ?? null
      : null;

    const participantIds = scene.participantNames
      .map(name => resolved._resolvedEntities.get(name))
      .filter(Boolean) as string[];

    await container.store.insertScene(storyId, {
      id: randomUUID(),
      title: scene.title,
      settingId,
      when: scene.when,
      summary: scene.summary,
      chapterNumber: scene.chapterNumber,
      eventIds: [],
      participantIds,
    });
    result.scenesAdded++;
  }

  // 8. Upsert plot threads
  for (const pt of resolved.plotThreads) {
    const relatedIds = pt.relatedEntityNames
      .map(name => resolved._resolvedEntities.get(name))
      .filter(Boolean) as string[];

    await container.store.upsertPlotThread(storyId, {
      id: randomUUID(),
      title: pt.title,
      description: pt.description,
      status: pt.status,
      introducedInSceneId: null,
      lastMentionedInSceneId: null,
      relatedEntityIds: relatedIds,
    });
    result.plotThreadsUpdated++;
  }

  // 9. Insert open questions
  for (const question of resolved.openQuestions) {
    await container.store.insertOpenQuestion(storyId, {
      id: randomUUID(),
      question,
      relatedEntityIds: [],
      introducedInDictationId: dictationId,
      resolvedInDictationId: null,
      isResolved: false,
    });
    result.openQuestionsAdded++;
  }

  // 10. Log contradictions
  for (const contradiction of resolved.contradictions) {
    await container.store.insertContradiction({
      storyId,
      newFactDescription: contradiction.newFactDescription,
      existingFactDescription: contradiction.existingFactDescription,
    });
    result.contradictionsFound++;
  }

  return result;
}
```

### 8.5 Reasoning Services

```typescript
// src/application/reasoning/ask-story.ts

import type { Container } from '../../container';
import { buildRelevantContext } from '../context/context-builder';

export async function askStory(
  container: Container,
  params: { storyId: string; question: string }
): Promise<string> {
  const context = await buildRelevantContext(container, {
    storyId: params.storyId,
    transcriptChunk: params.question,
  });

  const systemPrompt = `You are a knowledgeable assistant embedded within a novel's story world. You have access to the story's characters, events, relationships, and facts. Answer the writer's question based ONLY on the provided story context. If the answer is not in the context, say so clearly. Be specific and cite characters/events when possible.`;

  const userMessage = `## Story Context
${JSON.stringify(context, null, 2)}

## Writer's Question
${params.question}`;

  const result = await container.llm.complete({
    tier: 'standard',
    systemPrompt,
    userMessage,
    temperature: 0.3,
  });

  return result.text;
}
```

```typescript
// src/application/reasoning/knowledge-query.ts

import type { Container } from '../../container';

export async function doesEntityKnow(
  container: Container,
  params: { storyId: string; entityName: string; factDescription: string }
): Promise<{
  answer: boolean;
  confidence: 'certain' | 'likely' | 'uncertain';
  evidence: string[];
}> {
  // Step 1: Resolve the entity (of ANY type — a character, an AI, a sentient starship…)
  const entity = await container.store.findEntityByName(params.storyId, params.entityName);

  if (!entity) {
    return { answer: false, confidence: 'uncertain', evidence: [`Entity "${params.entityName}" not found`] };
  }

  // Step 2: Fetch the entity's knowledge
  const knowledge = await container.store.getKnowledge(params.storyId, entity.id);

  // Step 3: Use LLM to determine if the entity knows this fact
  const systemPrompt = `You are analyzing what an entity knows in a story. Based on the entity's knowledge list, determine if it knows the specified fact. Return a JSON object with: { answer: boolean, confidence: "certain"|"likely"|"uncertain", evidence: string[] }`;

  const userMessage = `## Entity's Known Information
${knowledge.map(k => `- ${k.knowledgeText} (status: ${k.status}, learned via: ${k.learnedVia ?? 'unknown'})`).join('\n')}

## Question: Does ${params.entityName} know: ${params.factDescription}?`;

  const result = await container.llm.complete({
    tier: 'standard',
    systemPrompt,
    userMessage,
    temperature: 0.1,
  });

  try {
    return JSON.parse(result.text);
  } catch {
    return { answer: false, confidence: 'uncertain', evidence: ['Failed to parse LLM response'] };
  }
}
```

```typescript
// src/application/reasoning/continuity-checker.ts

import type { Container } from '../../container';

export interface ContinuityIssue {
  type: 'character_consistency' | 'knowledge_anachronism' | 'timeline_paradox' | 'motivation_gap' | 'relationship_state' | 'dangling_thread';
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  relatedEntities: string[];
  relatedEvents: string[];
}

export async function runContinuityCheck(
  container: Container,
  storyId: string
): Promise<ContinuityIssue[]> {
  const story = await container.store.getStory(storyId);
  const issues: ContinuityIssue[] = [];

  // 1. Attribute consistency: compare an entity's key attributes across revisions (e.g. eye color).
  //    Works for ANY entity type via attribute defs — no hardcoded 'appearance'/'character' checks.

  // 2. Knowledge Anachronism: an entity knows something before they should
  for (const k of story.knowledge) {
    if (k.status === 'known' && k.learnedWhen) {
      const subject = story.entities.find(e => e.id === k.subjectEntityId);
      // Check if the entity has knowledge that predates the event that taught them
      // This is a simplified check — real implementation would compare timeline ordering
    }
  }

  // 3. Timeline Paradox: events out of order
  const sortedEvents = [...story.events].sort((a, b) => {
    const orderA = a.when?.normalized?.order ?? 0;
    const orderB = b.when?.normalized?.order ?? 0;
    return orderA - orderB;
  });

  // 4. Dangling Threads: plot threads not mentioned recently
  for (const pt of story.plotThreads) {
    if (pt.status === 'active' && pt.lastMentionedInSceneId) {
      const scenes = story.scenes;
      const lastMentionedIndex = scenes.findIndex(s => s.id === pt.lastMentionedInSceneId);
      const scenesSinceMention = scenes.length - lastMentionedIndex;
      if (scenesSinceMention > 5) {
        issues.push({
          type: 'dangling_thread',
          severity: 'warning',
          title: `Dangling plot thread: "${pt.title}"`,
          description: `This plot thread hasn't been mentioned in ${scenesSinceMention} scenes.`,
          relatedEntities: pt.relatedEntityIds,
          relatedEvents: [],
        });
      }
    }
  }

  // 5. Use LLM for deeper analysis
  if (story.events.length > 5) {
    const analysisResult = await container.llm.complete({
      tier: 'best',
      systemPrompt: `You are a literary continuity expert. Analyze the provided story data for continuity issues. Look for:
- Character behavior inconsistent with established personality
- Events that contradict established facts
- Motivations that don't align with stated goals
- Relationship states that don't match recent events
Return a JSON array of issues, each with: { type, severity, title, description, relatedEntities, relatedEvents }`,
      userMessage: JSON.stringify({
        entities: story.entities.map(e => ({
          name: e.name,
          entityType: story.entityTypes.find(t => t.id === e.entityTypeId)?.name,
          attributes: e.attributes,
        })),
        recentEvents: story.events.slice(-20),
        relationships: story.relationships,
        facts: story.facts.filter(f => !f.supersededBy),
      }),
      temperature: 0.2,
    });

    try {
      const llmIssues = JSON.parse(analysisResult.text);
      issues.push(...llmIssues);
    } catch {
      // LLM response wasn't valid JSON — skip LLM-sourced issues
    }
  }

  return issues;
}
```

---

## 9. API Routes

### 9.1 Upload Dictation

```typescript
// app/api/dictations/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { buildContainer } from '@/container';

export async function POST(request: NextRequest) {
  const container = buildContainer();
  const formData = await request.formData();
  const storyId = formData.get('storyId') as string;
  const audioFile = formData.get('audio') as File;
  // userId comes from the authenticated session (never from the form body)
  const { userId } = await requireSession(request); // from auth/session

  if (!storyId || !audioFile || !userId) {
    return NextResponse.json({ error: 'Missing storyId, audio file or user' }, { status: 400 });
  }

  // 1. Save audio to storage (e.g., Vercel Blob, S3)
  const audioUrl = await saveAudio(audioFile);

  // 2. Create dictation record, attributed to the authenticated user
  const dictationId = await container.transcriptStore.saveDictation({
    storyId,
    userId,
    audioUrl,
    status: 'pending',
  });

  // 3. Submit to AssemblyAI with a CLEAN webhook URL (no user/story in query params)
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/hooks/stt-callback`;

  const { jobId } = await container.stt.submitTranscription({
    audioBuffer: Buffer.from(await audioFile.arrayBuffer()),
    mimeType: audioFile.type,
    webhookUrl,
    // AssemblyAI echoes this back in a header so the callback can be authenticated
    webhookAuth: { headerName: 'x-webhook-secret', headerValue: process.env.WEBHOOK_SECRET! },
  });

  // 4. Persist the provider job id — it is the correlation key at callback time
  await container.transcriptStore.updateDictation(dictationId, {
    providerJobId: jobId,
    status: 'processing',
  });

  return NextResponse.json({ dictationId, jobId });
}
```

### 9.2 AssemblyAI Webhook

```typescript
// app/api/hooks/stt-callback/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { buildContainer } from '@/container';

export async function POST(request: NextRequest) {
  // 1. Authenticate the callback: AssemblyAI echoes webhook_auth_header_value
  //    (set at submit time) back in the named header. Nothing else is trusted.
  if (request.headers.get('x-webhook-secret') !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const container = buildContainer();
  const body = await request.json();

  // 2. The webhook carries ONLY the provider job id. Resolve it against the DB
  //    row to learn which user/story this belongs to — never from URL params.
  const transcriptId = body.transcript_id;
  const dictation = await container.transcriptStore.findDictationByProviderJobId(transcriptId);

  if (!dictation) {
    return NextResponse.json({ error: 'Unknown transcript' }, { status: 404 });
  }

  if (body.status === 'completed') {
    // 3. Fetch the transcript text from AssemblyAI (webhook bodies can be partial;
    //    GET /v2/transcript/{id} is the source of truth)
    const result = await container.stt.getTranscript(transcriptId);

    // 4. Save transcript for THIS user's dictation
    await container.transcriptStore.updateDictation(dictation.id, {
      transcript: result.transcript,
      wordCount: result.transcript.split(/\s+/).length,
      status: 'completed',
      processedAt: new Date(),
    });

    // 5. Queue extraction for that user's story (SQS consumer runs at bounded
    //    concurrency to stay under AssemblyAI's account rate limit)
    await container.queue.enqueue('extraction', {
      dictationId: dictation.id,
      storyId: dictation.storyId,
      transcript: result.transcript,
    });
  } else {
    await container.transcriptStore.updateDictation(dictation.id, {
      status: 'failed',
    });
  }

  return NextResponse.json({ received: true });
}
```

### 9.3 Extraction Worker

```typescript
// workers/extraction-worker.ts

import { buildContainer } from '../src/container';
import { extractFromTranscript } from '../src/application/extraction/extract-entities';
import { resolveProposals } from '../src/application/extraction/resolve-proposals';
import { commitProposals } from '../src/application/extraction/commit-proposals';
import { buildRelevantContext } from '../src/application/context/context-builder';

async function startWorker() {
  const container = buildContainer();

  container.queue.onJobCompleted('extraction', async (data: any) => {
    const { dictationId, storyId, transcript } = data;
    console.log(`[Extraction] Processing dictation ${dictationId}`);

    try {
      // 1. Build relevant context
      const context = await buildRelevantContext(container, {
        storyId,
        transcriptChunk: transcript,
      });

      // 2. Extract proposal from LLM
      const { proposal, usage } = await extractFromTranscript(container, {
        transcript,
        storyId,
        existingContext: JSON.stringify(context),
      });

      // 3. Resolve entity names to IDs
      const resolved = await resolveProposals(container, storyId, proposal);

      // 4. Commit to database
      const result = await commitProposals(container, {
        storyId,
        dictationId,
        resolved,
        usage,
      });

      console.log(`[Extraction] Completed:`, result);
    } catch (error) {
      console.error(`[Extraction] Failed for dictation ${dictationId}:`, error);
    }
  });

  console.log('[Extraction Worker] Started');
}

startWorker();
```

### 9.4 Story Query API

```typescript
// app/api/stories/[storyId]/ask/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { buildContainer } from '@/container';
import { askStory } from '@/src/application/reasoning/ask-story';

export async function POST(
  request: NextRequest,
  { params }: { params: { storyId: string } }
) {
  const container = buildContainer();
  const { question } = await request.json();

  if (!question) {
    return NextResponse.json({ error: 'Missing question' }, { status: 400 });
  }

  const answer = await askStory(container, {
    storyId: params.storyId,
    question,
  });

  return NextResponse.json({ answer });
}
```

```typescript
// app/api/stories/[storyId]/knowledge/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { buildContainer } from '@/container';
import { doesEntityKnow } from '@/src/application/reasoning/knowledge-query';

export async function POST(
  request: NextRequest,
  { params }: { params: { storyId: string } }
) {
  const container = buildContainer();
  const { entityName, factDescription } = await request.json();

  if (!entityName || !factDescription) {
    return NextResponse.json({ error: 'Missing entityName or factDescription' }, { status: 400 });
  }

  const result = await doesEntityKnow(container, {
    storyId: params.storyId,
    entityName,
    factDescription,
  });

  return NextResponse.json(result);
}
```

---

## 10. UI Components

### 10.1 Main Layout with Sidebar

```typescript
// app/(app)/layout.tsx

import { Sidebar } from '@/src/ui/components/layout/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
```

```typescript
// src/ui/components/layout/sidebar.tsx

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Static, always-present sections.
const NAV_ITEMS = [
  { label: 'My Stories', href: '/', icon: '📖' },
  { label: 'Manuscript', href: '/manuscript', icon: '📝' },
  { label: 'Timeline', href: '/timeline', icon: '🕐' },
  { label: 'Relationships', href: '/relationships', icon: '🎭' },
  { label: 'Open Questions', href: '/open-questions', icon: '❓' },
  { label: 'Plot Threads', href: '/plot-threads', icon: '🧩' },
  { label: 'Debugger', href: '/debugger', icon: '🔍' },
];

// Dynamic entity sections — derived from the story's entity-type registry.
// Core seeds always render "Characters" / "Places" (+ the Relationships edge);
// a space-opera story additionally renders "Starships", "Factions", "Planets".
// const ENTITY_SECTIONS = entityTypes.map(t => ({ label: t.pluralName, href: `/entities?type=${t.name}` }));

export function Sidebar() {
  const pathname = usePathname();
  // const entityTypes = ... // fetched from the active story; see ENTITY_SECTIONS above

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold">NovelOS</h1>
      </div>
      <nav className="flex-1 overflow-auto py-2">
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-800 ${
              pathname === item.href ? 'bg-gray-800 text-white' : 'text-gray-400'
            }`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

### 10.2 Dictation Screen

```typescript
// src/ui/components/dictate/mic-button.tsx

'use client';

import { useState, useRef, useCallback } from 'react';

interface MicButtonProps {
  onRecordingComplete: (blob: Blob) => void;
}

export function MicButton({ onRecordingComplete }: MicButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      onRecordingComplete(blob);
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start();
    setIsRecording(true);
    setDuration(0);
    timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
  }, [onRecordingComplete]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        className={`w-32 h-32 rounded-full flex items-center justify-center text-4xl transition-all ${
          isRecording
            ? 'bg-red-500 animate-pulse scale-110'
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isRecording ? '⏹' : '🎙️'}
      </button>
      {isRecording && (
        <p className="text-gray-600">Recording: {Math.floor(duration / 60)}:{(duration % 60).toString().padStart(2, '0')}</p>
      )}
    </div>
  );
}
```

### 10.3 Entity Card (schema-driven — works for characters, starships, factions, …)

```typescript
// src/ui/components/story/entity-card.tsx

import { Entity, EntityType, AttributeValue } from '@/src/core/domain/story-world';

interface EntityCardProps {
  entity: Entity;
  type: EntityType;   // the entity's registry def — drives which attributes render
  entityTypeName: string;
  onClick?: () => void;
}

// Render what the type declares — a character shows goals/fears/secrets,
// a starship shows class/armament/captain. No per-kind components.
export function EntityCard({ entity, type, entityTypeName, onClick }: EntityCardProps) {
  // First m attributeDefs that have values, then the rest
  const filled = type.attributeDefs.filter(d => entity.attributes[d.key] !== undefined);
  const defByKey = new Map(type.attributeDefs.map(d => [d.key, d]));

  return (
    <div
      onClick={onClick}
      className="p-4 bg-white rounded-lg border border-gray-200 hover:border-blue-300 cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-400 uppercase">{entityTypeName}</span>
        <h3 className="font-semibold text-lg">{entity.name}</h3>
        {entity.aliases.length > 0 && (
          <span className="text-sm text-gray-500">({entity.aliases.join(', ')})</span>
        )}
      </div>

      {filled.slice(0, 3).map(def => {
        const value: AttributeValue | undefined = entity.attributes[def.key];
        if (value == null) return null;
        const text = Array.isArray(value) ? value.join(', ') : String(value);
        return (
          <div key={def.key} className="mb-1 text-sm text-gray-700">
            <span className="text-xs font-medium text-gray-500 uppercase mr-2">{def.label}</span>
            {text}
          </div>
        );
      })}
    </div>
  );
}
```

### 10.4 Knowledge Query Component

```typescript
// src/ui/components/shared/knowledge-status.tsx

'use client';

import { useState } from 'react';

interface KnowledgeQueryResult {
  answer: boolean;
  confidence: 'certain' | 'likely' | 'uncertain';
  evidence: string[];
}

export function KnowledgeQuery({ storyId }: { storyId: string }) {
  const [entityName, setEntityName] = useState('');
  const [factDescription, setFactDescription] = useState('');
  const [result, setResult] = useState<KnowledgeQueryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const query = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/stories/${storyId}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityName, factDescription }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg border">
      <h3 className="font-semibold mb-3">Does This Entity Know?</h3>
      <div className="flex gap-2 mb-3">
        <input
          placeholder="Entity name (character, AI, ship…)"
          value={entityName}
          onChange={e => setEntityName(e.target.value)}
          className="flex-1 px-3 py-2 border rounded"
        />
        <input
          placeholder="What fact?"
          value={factDescription}
          onChange={e => setFactDescription(e.target.value)}
          className="flex-1 px-3 py-2 border rounded"
        />
        <button
          onClick={query}
          disabled={loading || !entityName || !factDescription}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {loading ? '...' : 'Ask'}
        </button>
      </div>
      {result && (
        <div className={`p-3 rounded ${result.answer ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'} border`}>
          <p className="font-medium">
            {result.answer ? '✅ Yes' : '❌ No'} — {result.confidence} confidence
          </p>
          {result.evidence.length > 0 && (
            <ul className="text-sm mt-2 text-gray-600">
              {result.evidence.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## 11. Open Questions Feature

The Open Questions system tracks unanswered story questions and feeds them back into the extraction context so the LLM prioritizes resolving them.

```typescript
// In the extraction prompt, append:

function appendOpenQuestions(prompt: string, openQuestions: string[]): string {
  if (openQuestions.length === 0) return prompt;

  return `${prompt}

## Open Questions to Consider
The writer has left these questions unanswered. If the current transcript addresses any of them, note it in your response and mark the question as potentially resolved:
${openQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}
```

UI component for Open Questions:

```typescript
// src/ui/components/story/open-questions-view.tsx

import { OpenQuestion } from '@/src/core/domain/story-world';

export function OpenQuestionsView({ questions }: { questions: OpenQuestion[] }) {
  const unresolved = questions.filter(q => !q.isResolved);
  const resolved = questions.filter(q => q.isResolved);

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold mb-4">Open Questions ({unresolved.length})</h2>
      {unresolved.length === 0 && (
        <p className="text-gray-500">No open questions. All mysteries resolved!</p>
      )}
      <ul className="space-y-2">
        {unresolved.map(q => (
          <li key={q.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded">
            <span className="text-yellow-600 mr-2">❓</span>
            {q.question}
          </li>
        ))}
      </ul>

      {resolved.length > 0 && (
        <>
          <h3 className="text-lg font-semibold mt-6 mb-3 text-gray-500">Resolved ({resolved.length})</h3>
          <ul className="space-y-2 opacity-60">
            {resolved.map(q => (
              <li key={q.id} className="p-3 bg-gray-50 border line-through">
                ✅ {q.question}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

---

## 12. Contradiction UX

When the extraction pipeline detects a contradiction:

1. **Supersede** (auto-resolve): The old fact is automatically superseded, and a notification is logged in the writer's feed. The writer can undo.
2. **Flag Soft** (warning): Shows a warning card in the UI but doesn't block the pipeline.
3. **Flag Hard** (requires confirmation): Blocks processing until the writer explicitly resolves it.

```typescript
// src/ui/components/debugger/contradiction-card.tsx

interface ContradictionCardProps {
  existingFact: string;
  newFact: string;
  onAction: (action: 'supersede' | 'keep_existing' | 'keep_new' | 'flag_soft') => void;
}

export function ContradictionCard({ existingFact, newFact, onAction }: ContradictionCardProps) {
  return (
    <div className="p-4 bg-red-50 border-2 border-red-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-red-500 text-xl">⚠️</span>
        <h4 className="font-semibold text-red-800">Contradiction Detected</h4>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-3 bg-white rounded border">
          <span className="text-xs font-medium text-gray-500">EXISTING FACT</span>
          <p className="mt-1">{existingFact}</p>
        </div>
        <div className="p-3 bg-white rounded border">
          <span className="text-xs font-medium text-gray-500">NEW STATEMENT</span>
          <p className="mt-1">{newFact}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => onAction('supersede')} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">
          Update to New
        </button>
        <button onClick={() => onAction('keep_existing')} className="px-3 py-1 bg-gray-200 rounded text-sm">
          Keep Existing
        </button>
        <button onClick={() => onAction('flag_soft')} className="px-3 py-1 bg-yellow-100 border border-yellow-300 rounded text-sm">
          Mark for Review
        </button>
      </div>
    </div>
  );
}
```

---

## 13. Step-by-Step Build Order

### Phase 1: Foundation (Week 1)
1. **T0.1-T0.4**: Project bootstrap, dependencies, path aliases, env config
2. **T1.1-T1.8**: All domain types (pure TypeScript, no I/O)
3. **T1.9-T1.11**: Domain unit tests

### Phase 2: Ports + In-Memory Adapters (Week 1-2)
4. **T2.1-T2.8**: All port interfaces
5. **T3.1-T3.7**: All in-memory adapters

### Phase 3: Composition Root (Week 2)
6. **T4.1-T4.5**: DI container + contract tests

### Phase 4: Core Application Logic (Week 2-3)
7. **T5.1-T5.7**: Extraction pipeline (prompts → resolve → stratify → commit)
8. **T6.1-T6.3**: Context builder

### Phase 5: Reasoning Layer (Week 3)
9. **T7.1-T7.4**: Ask story, knowledge query, continuity checker

### Phase 6: Database (Week 3-4)
10. **T8.1-T8.5**: Drizzle schema + Postgres adapters

### Phase 7: Real Adapters (Week 4)
11. **T9.1-T9.3**: OpenAI LLM adapter
12. **T10.1-T10.2**: AssemblyAI STT adapter
13. **T11.1-T11.3**: AWS SQS job queue

### Phase 8: API Routes (Week 4-5)
14. **T12.1-T12.8**: All API endpoints

### Phase 9: UI (Week 5-6)
15. **T13.1**: Layout + sidebar
16. **T13.2-T13.3**: Dictation screen (mic + processing)
17. **T13.4-T13.6**: Story views (characters, scenes, etc.)
18. **T13.7-T13.8**: Ask + debugger screens

### Phase 10: Polish (Week 6)
19. **T14.1-T14.2**: pgvector embeddings
20. **T15.1-T15.5**: Full test suite
21. **T16.1-T16.4**: Error states, responsive design, deployment, README

---

## 14. Cost Projections

Based on PLAN.md estimates:

| Component | Monthly Cost (Heavy User) |
|---|---|
| AssemblyAI STT (20 hrs/month @ $0.21/hr) | ~$4.20 |
| LLM Extraction (cheap tier, ~100k tokens/day) | ~$5.00 |
| LLM Reasoning (standard tier, ~20k tokens/day) | ~$15.00 |
| LLM Analysis (best tier, occasional) | ~$5.00 |
| PostgreSQL (Supabase free tier → Pro) | $0-$25 |
| SQS (fully managed; ~$0.40/1M requests) | $0 |
| Vercel Hosting | $0-$20 |
| **Total** | **~$30-75/month** |

---

## 15. Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/novelos

# Job queue (AWS SQS)
AWS_REGION=us-east-1
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789012/novelos-extraction

# Webhook auth (AssemblyAI STT callbacks)
WEBHOOK_SECRET=change-me

# AssemblyAI
ASSEMBLYAI_API_KEY=your_assemblyai_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
NODE_ENV=development
```
