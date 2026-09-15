# NovelOS — Actionable Task List

Derived from IMPLEMENTATION.md. Tasks are ordered by dependency. Each task has a clear scope, output artifact, and acceptance criteria.

---

## Phase 0: Project Bootstrap

### T0.1 — Initialize Next.js project
- **Scope:** Create a new Next.js (App Router, TypeScript, Tailwind, ESLint) project in the current directory.
- **Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`
- **Deps:** None
- **Acceptance:** `npm run dev` starts without error. `npm run lint` passes.

### T0.2 — Install core dependencies
- **Scope:** Install Zod, Drizzle ORM + `drizzle-kit`, `@trpc/server` (optional, for type-safe RPC later), `uuid`, `nanoid`, `@evyweb/ioctopus` (IoC container — the abstraction/composition mechanism replacing hand-rolled DI and port barrels). Add dev deps: `vitest`, `@types/node`.
- **Files:** `package.json`
- **Deps:** T0.1
- **Acceptance:** `npm run typecheck` passes (empty `src/` is fine). Vitest runs (`npx vitest --run` exits cleanly).

### T0.3 — Configure path aliases
- **Scope:** Set up `@/` alias in `tsconfig.json` pointing to `./src`. Create empty barrel files: `src/domain/index.ts`, `src/adapters/index.ts`, `src/services/index.ts`. Set up the **composition root on `@evyweb/ioctopus`**: `src/container/index.ts` exporting a typed `AppRegistry` (`CONFIG`), `createAppModule`, and `buildContainer`.
- **Files:** `tsconfig.json`, barrel files, `src/container/index.ts`
- **Deps:** T0.1, T0.2
- **Acceptance:** `import { } from '@/domain'` resolves in a test file. `buildContainer()` returns a typed container that resolves `CONFIG`.

### T0.4 — Configure env and config module
- **Scope:** Create `src/config/index.ts` exporting a typed `AppConfig` interface. Use `process.env` with runtime validation (Zod) at startup. Fields: `STT_PROVIDER`, `LLM_PROVIDER`, `LLM_CHEAP_MODEL`, `LLM_STANDARD_MODEL`, `LLM_BEST_MODEL`, `DATABASE_URL`, `AWS_REGION`, `SQS_QUEUE_URL`, `WEBHOOK_SECRET`, `STT_API_KEY`, `LLM_API_KEY`.
- **Files:** `src/config/index.ts`, `.env.example`
- **Deps:** T0.2
- **Acceptance:** `import { loadConfig } from '@/config'` returns typed object; missing required env throws at call time.

---

## Phase 1: Domain Layer (pure types, zero I/O)

> **Design note (dynamic entity model).** Two tiers. **Core types** (`character`, `place`) plus the **relationship** edge exist in every story, are designed explicitly (portrait/photo upload, character sheet, place card, relationship graph), and cannot be deleted. Everything else is **dynamic**: new entity types are created by the user (UI/API), by a story-type preset, or proposed by the extraction LLM, and each derives from a **base kind** (`character | place | physical | abstract`) that drives capabilities — `physical` (starships, items) supports image attachments, `abstract` (factions, concepts) is text-only. All generic logic operates over `Entity` via `entityTypeId` + `attributes` + `media`. See IMPLEMENTATION.md §5 & §5.3.

### T1.1 — Entity-type registry & base kinds
- **Scope:** Define `AttributeValue` (string | number | boolean | string[] | null), `AttributeKind` (`text | number | boolean | enum | ref | timeline`), `AttributeDef` (`key, label, kind, required?, multi?, enumValues?, refType?`), `EntityBaseKind` (`character | place | physical | abstract`), the `BASE_KIND_CATALOG` (`label, supportsMedia, isCore` — character/place are core with media; physical has media; abstract text-only), and `EntityType` (`id, storyId (null = shared template), name, pluralName, baseKind, description, attributeDefs, origin: 'core' | 'preset' | 'extracted' | 'user', supersededBy?, createdAt`). Ship core **seeds as data** (`src/domain/builtins.ts`): `character` and `place` (origin `core`, guaranteed present, with attributeDefs: goals, fears, desires, beliefs, secrets, appearance, personality, backstory…) plus a convenience `object` seed (baseKind `physical`). Ship story-type presets as **data** (`src/domain/story-types.ts`): e.g. `"space-opera"` → `starship` (physical, class/armament/captain), `planet` (place), `faction` (abstract), `technology`, `alien-species`.
- **Files:** `src/domain/entity-types.ts`, `src/domain/base-kinds.ts`, `src/domain/builtins.ts`, `src/domain/story-types.ts`
- **Deps:** T0.3
- **Acceptance:** Zod schemas parse valid defs and reject invalid `kind`/`multi`/`baseKind` combos. `character` seed round-trips; the `space-opera` preset including a `starship` def parses. `BASE_KIND_CATALOG.abstract.supportsMedia === false`. No module imports I/O or app code.

### T1.2 — Generic entity & MediaRef
- **Scope:** Define `MediaRef` (`id, url, role: 'portrait' | 'gallery', caption?, createdAt`) and `Entity` (`id, storyId, entityTypeId, name, aliases, attributes: Record<string, AttributeValue>, media: MediaRef[]`) — replacing the old `Character | Location | StoryObject` union. Define `StoryWorld` including `storyType: string | null` and `entityTypes: EntityType[]` (the registry). Add a pure helper `validateAttributes(entityTypeDef, attributes)` that coerces/normalizes or returns errors against `attributeDefs` (rejects unknown keys, enforces `required`, checks `multi` shape, `enumValues`, `refType` presence). Add a companion `validateEntity(entityTypeDef, entity)` that additionally rejects `media` when `baseKind.supportsMedia` is false (e.g. abstract).
- **Files:** `src/domain/entities.ts`, `src/domain/story-world.ts`
- **Deps:** T1.1
- **Acceptance:** `validateAttributes` accepts valid `character` attrs and a `starship` attrs map; rejects unknown keys (`eyeColor` when not declared) and missing required keys. `validateEntity` rejects media on an `abstract`-base type. `tsc --noEmit` passes.

### T1.3 — Provenance, confidence, facts
- **Scope:** Define `Confidence` (`'explicit' | 'implied' | 'inferred' | 'unknown'`), `Provenance` (dictationId + textChunk + confidence), `FactKind`, `Claim`, `Fact` (subject/predicate/objectValue, confidence, provenance, supersededBy). Facts stay type-agnostic triplets — subject/object can reference any entity or free text.
- **Files:** `src/domain/provenance.ts`
- **Deps:** T1.1
- **Acceptance:** `Fact.confidence` is the four-value union.

### T1.4 — Event, timeline, relationship types
- **Scope:** Define `TimelineRef`, `StoryEvent` (uses **`settingId`** — ref to any entity, plus `participants` and `involvedObjects` as generic entity ID arrays), `Relationship` (from/to any entity), `RelationshipChange`. No per-kind assumptions.
- **Files:** `src/domain/events.ts`, `src/domain/relationships.ts`
- **Deps:** T1.2
- **Acceptance:** Types compile; events/scenes reference settings/participants generically.

### T1.5 — Knowledge, scene, plot thread, open question types
- **Scope:** Define `KnowledgeClaim`/`KnowledgeChange`/`KnowledgeStatus` with **`subjectEntityId`** (any entity can "know" — an AI, a faction, a sentient starship), `Scene` (`settingId`, generic `participantIds`, `eventIds`), `PlotThread`, `OpenQuestion`, `Draft`, `Meta`.
- **Files:** `src/domain/knowledge.ts`, `src/domain/scenes.ts`, `src/domain/plot-threads.ts`, `src/domain/story-world.ts`
- **Deps:** T1.3, T1.4
- **Acceptance:** `KnowledgeClaim.subjectEntityId` is a plain entity ID (no `characterId` anywhere in domain).

### T1.6 — Proposal Zod schemas
- **Scope:** Mirror the `StoryChangeProposals` shape from IMPLEMENTATION.md §5.2: `proposedAttributeDefSchema`, `proposedEntityTypeSchema` (name, pluralName, **baseKind**, description, attributeDefs), `proposedEntitySchema` (**`entityTypeName`** + name + aliases + attributes — works for any type, existing or concurrently proposed), `eventSchema` (`settingName`, `participantNames`, `involvedObjectNames`), `relationshipSchema`, `factSchema`, `knowledgeSchema` (`subjectEntityName`), `sceneSchema`, `plotThreadSchema`, `timelineRefSchema`, and the root `storyChangeSchema` with `entityTypes[]`, `entities[]`, `events[]`, … , `knowledge[]`, `openQuestions`, `contradictions`. Export both schemas and inferred types.
- **Files:** `src/domain/proposals.ts`
- **Deps:** T1.1–T1.5
- **Acceptance:** A proposal that registers a new `starship` type, adds two starships, an event with `settingName: "Oasis Moon"`, and a knowledge row parses. Missing required fields rejects.

### T1.7 — Commit and CommitResult types
- **Scope:** Define `Commit` (proposed mutations to the story world + new entity types) and `CommitResult` with **per-entity-type counts** (`entitiesCreatedByType: Record<string, number>` instead of charactersCreated/locationsCreated/objectsCreated), plus `entityTypesCreated`, `eventsAdded`, `factsAdded`, `relationshipsAdded`, `knowledgeAdded`, `scenesAdded`, `plotThreadsUpdated`, `openQuestionsAdded`, `contradictionsFound`, `SupersedeAction` enum.
- **Files:** `src/domain/commits.ts`
- **Deps:** T1.6
- **Acceptance:** Types compile.

### T1.8 — Domain barrel export
- **Scope:** `src/domain/index.ts` re-exports all types, schemas, built-in seeds, and story-type presets. No logic files — only types and schemas.
- **Files:** `src/domain/index.ts`
- **Deps:** T1.1–T1.7
- **Acceptance:** `import { StoryWorld, storyChangeSchema, coreEntityTypes, spaceOperaPreset } from '@/domain'` works in a test file.

### T1.9 — Domain unit tests: proposal validation + registry
- **Scope:** Vitest tests parsing valid/invalid `StoryChangeProposals` through `storyChangeSchema`, but now covering: (a) registering a new entity type (`starship` with `baseKind: "physical"`) with attributeDefs, (b) entities of a built-in and of a new type, (c) defaults (empty arrays for absent fields), (d) rejection of invalid `confidence` values, (e) `validateAttributes` rejecting attribute keys not declared by the entity type, (f) `validateEntity` rejecting media on an `abstract`-base entity, (g) a proposed type missing `baseKind` rejects.
- **Files:** `tests/domain/proposals.test.ts`, `tests/domain/entity-types.test.ts`
- **Deps:** T1.6, T1.2
- **Acceptance:** All tests pass. Invalid inputs throw ZodError with descriptive messages.

### T1.10 — Domain unit tests: fact supersede rules + knowledge generalization
- **Scope:** Pure-function tests for supersede logic (a fact with `supersededBy` set is excluded from active canon queries; `inferred` facts never auto-upgrade to `explicit`). Also assert knowledge rows reference `subjectEntityId` (any type) and timeline-based queries (`learnedWhen`) can be filtered.
- **Files:** `tests/domain/provenance.test.ts`, `tests/domain/knowledge.test.ts`
- **Deps:** T1.3, T1.5
- **Acceptance:** Tests pass. `inferred → explicit` upgrade attempt throws/rejects.

### T1.11 — Domain unit tests: applyCommit
- **Scope:** Pure-function tests for `applyCommit` (pure reducer over `StoryWorld` + `Commit`). Verify: a brand-new entity type gets registered in `StoryWorld.entityTypes` (with its `baseKind`), entities of the new type are added and count in `entitiesCreatedByType`, entity attributes updated, events appended (generic settings/participants), facts written with correct confidence, contradictions flagged, open questions appended, revision bumped. Edge cases: empty commit, supersede-only commit, commit with contradictions, commit that attaches media to an `abstract`-base entity is rejected. `character`/`place` seeds survive in the world after any commit.
- **Files:** `tests/domain/commits.test.ts`
- **Deps:** T1.7
- **Acceptance:** All tests pass; a `space-opera` world seeded via the preset passes the same suite.

---

## Phase 2: Container Registry (IoC tokens & port contracts)

The abstraction layer lives in `src/container/` as the `@evyweb/ioctopus` registry. Each port is a plain TypeScript contract (no runtime code) whose injection token will be added to `AppRegistry`.

### T2.1 — LlmClient port
- **Scope (revised, user decision):** Define `ModelTier`, `LlmClient` interface (`complete`, `extractStructured`), `CompletionRequest`, `ExtractionRequest<T>`, `ExtractionResult<T>`. The original `chat` method **and** its native-function-calling types (`ToolDefinition`, `ChatMessage`, `ToolCall`, `ChatRequest`, `ChatResult`) were **removed from the port** — the extraction agent loop (T5.4) is now driven by the **Vercel AI SDK** (`generateText` + `tools` + `stopWhen`), which owns message/tool-call assembly. `complete`/`extractStructured` remain for non-loop LLM calls. **No SemanticStore — the extraction agent fetches entities by registry type with bounded limits instead of embedding search.**
- **Files:** `src/container/llm.ts`
- **Deps:** T0.3
- **Acceptance:** Interface compiles. No runtime code.

### T2.2 — SpeechToText port
- **Scope:** Define `SpeechToText` interface, `TranscriptSegment`, `TranscribeRequest`, `TranscriptResult`.
- **Files:** `src/container/stt.ts`
- **Deps:** T0.3
- **Acceptance:** Interface compiles.

### T2.3 — StoryWorldStore port
- **Scope:** Define `StoryWorldStore` interface with `getWorld`, `commit`, `getEntity`, `queryEvents`, `byRevision`, plus **entity-type registry operations** (`upsertEntityType`, `getEntityTypes`, `findEntityTypeByName`), **type-agnostic entity operations** (`findEntityByName` matching name + aliases across all types, `listEntities` with optional `entityTypeId` filter), **media operations** (`attachMedia`, `getMedia`), and generalized knowledge ops (`insertKnowledge`, `getKnowledge(subjectEntityId)`). Define `EntityRef`, `EventQuery`, `Snapshot` types.
- **Files:** `src/container/story-world-store.ts`
- **Deps:** T1.7
- **Acceptance:** Interface compiles. `commit` returns `CommitResult`. There is **no `kind` parameter / no per-entity-kind method** anywhere in the port.

### T2.4 — TranscriptStore port
- **Scope:** Define `TranscriptStore` interface (`saveDictation`, `getDictation`, `updateDictation`, `listDictations`). Dictation rows are **multi-tenant**: every row carries `userId` (`id`, `userId`, `storyId`, `providerJobId`, text, segments, durationSec, createdAt). `providerJobId` stores the AssemblyAI `transcript_id` at submit time; `findDictationByProviderJobId` is the async **callback-correlation lookup** (`transcript_id` → dictation → `userId`/`storyId`). No per-entity-kind methods.
- **Files:** `src/container/transcript-store.ts`
- **Deps:** T0.3
- **Acceptance:** Interface compiles.

### T2.5 — JobQueue port
- **Scope:** Define `JobQueue` interface with `enqueue`, `onJobCompleted`, `onJobFailed`, `getStatus`. Define `JobStatus`, `ExtractionJob` types.
- **Files:** `src/container/job-queue.ts`
- **Deps:** T0.3
- **Acceptance:** Interface compiles.

### T2.6 — Clock port
- **Scope:** Define `Clock` interface: `now(): Date`, `elapsed(ms: number): boolean`. Simple abstraction for testability.
- **Files:** `src/container/clock.ts`
- **Deps:** T0.3
- **Acceptance:** Interface compiles.

### T2.7 — Registry + container barrel export
- **Scope:** Re-export all port contracts from `src/container/registry.ts` and compose them into the typed `AppRegistry`. `src/container/index.ts` re-exports the registry, `createAppModule`, and `buildContainer`.
- **Files:** `src/container/registry.ts`, `src/container/index.ts`
- **Deps:** T2.1–T2.6
- **Acceptance:** `import { AppRegistry, LlmClient, SpeechToText } from '@/container'` works.

---

## Phase 3: Memory Adapters (for tests and dev)

### T3.1 — In-memory LLM adapter ✅ Done
- **Scope:** Implement `LlmClient` backed by a `Map<string, StoryChangeProposals>` fixture store. `extractStructured` returns the matching fixture or a sensible default. `complete` returns canned strings. The agent loop no longer goes through `LlmClient.chat` — deterministic loop tests (T5.4) script an AI SDK `LanguageModel` via `tests/mocks/sdk-model.ts` (`scriptedModel(steps)` → `MockLanguageModelV4`), and the T5.2 executor runs the tool calls in-process.
- **Files:** `tests/mocks/llm.ts`
- **Deps:** T2.1, T1.6
- **Acceptance:** Passes a mock contract test (see T4.5).

### T3.2 — In-memory STT adapter ✅ Done
- **Scope:** Implement `SpeechToText` that immediately returns a canned transcript. Configurable via constructor injection.
- **Files:** `tests/mocks/stt.ts`
- **Deps:** T2.2
- **Acceptance:** `transcribe` resolves immediately with `{ jobId: 'mock-1' }`.

### T3.3 — In-memory StoryWorldStore adapter ✅ Done
- **Scope:** Implement `StoryWorldStore` using `Map<string, StoryWorld>`. `commit` appends events, upserts entities of any type, registers new entity types, upserts facts/knowledge, bumps revision atomically. `getEntity` does linear scan. `queryEvents` filters by predicates. Entity-name lookup matches name + aliases across all types.
- **Files:** `tests/mocks/story-world-store.ts`
- **Deps:** T2.3, T1.7, T1.6
- **Acceptance:** Commit tests from T1.11 can use this adapter as the backing store, including a commit that registers a `starship` type and adds starship entities.

### T3.4 — In-memory TranscriptStore adapter ✅ Done
- **Scope:** Implement `TranscriptStore` using `Map<string, Dictation>`. `search` does case-insensitive substring match.
- **Files:** `tests/mocks/transcript-store.ts`
- **Deps:** T2.4
- **Acceptance:** Round-trip save/get works.

### T3.5 — In-memory JobQueue adapter ✅ Done
- **Scope:** Implement `JobQueue<T>` that immediately invokes registered handlers on `enqueue`. Useful for synchronous testing of the full pipeline.
- **Files:** `tests/mocks/job-queue.ts`
- **Deps:** T2.5
- **Acceptance:** `enqueue` triggers the `onJobCompleted` handler. `getStatus` returns `'completed'` after the handler finishes.

### T3.6 — Mock adapter barrel export ✅ Done
- **Scope:** Re-export all mock adapters from `tests/mocks/index.ts` (mocks are test doubles — they do **not** live in `src/`; production `src/adapters/` holds only real adapters).
- **Files:** `tests/mocks/index.ts`
- **Deps:** T3.1–T3.5
- **Acceptance:** `import { mockLlm, mockStt } from 'tests/mocks'` works.

---

## Phase 4: Composition Root & Service Container (ioctopus)

### T4.1 — ✅ Done AppRegistry extension
- **Scope:** Extend the typed `AppRegistry` in `src/container/registry.ts` to map every port contract + `CONFIG` to its injection token. Consumers resolve typed dependencies via `container.get('...')` — no manual `ServiceContainer` type needed.
- **Files:** `src/container/registry.ts`, `src/container/index.ts`
- **Deps:** T2.7, T0.4
- **Acceptance:** Type compiles; `container.get('LLM')` returns `LlmClient` with no cast.

### T4.2 — ✅ Done buildMemoryContainer for mock adapters
- **Scope:** Implement `buildMemoryContainer()` that wires all mock adapters into an ioctopus `createContainer<AppRegistry>` (loading them via `createModule` or direct `bind`). Used for tests and dev.
- **Files:** `tests/mocks/memory-container.ts`
- **Deps:** T3.6, T4.1
- **Acceptance:** `buildMemoryContainer().get('STT').submitTranscription(...)` works end-to-end.

### T4.3 — ✅ Done buildContainer for production (stub)
- **Scope:** Implement `buildContainer(config: AppConfig)` that reads config and binds real adapters. Initially throw `NotImplementedError` for adapters not yet built (both real *and* none-default — mock adapters exist only under `tests/mocks`).
- **Files:** `src/container/index.ts`
- **Deps:** T4.1, T0.4
- **Acceptance:** `buildContainer(loadConfig(process.env))` throws descriptive error for missing adapters (not a generic crash).

### T4.4 — ✅ Done Scoped container isolation
- **Scope:** Guarantee that concurrent requests/tests get independent container instances so mock adapters don't leak state. Since mocks live in tests, each `buildMemoryContainer()` call binds fresh adapter instances (ioctopus singleton scope is per-container); a per-request memoizing wrapper (`React.cache`) will only be added when the src container has real adapters to memoize (T8.5).
- **Files:** `tests/mocks/memory-container.ts`
- **Deps:** T4.2
- **Acceptance:** Multiple `buildMemoryContainer()` calls produce independent adapters (no shared mutable state between containers).

### T4.5 — ✅ Done Adapter contract test suite
- **Scope:** Write a generic adapter contract test: given a factory function `() => StoryWorldStore`, run a standard set of tests (create, get, commit, supersede, getEntity). Export as a reusable test helper. Apply to memory adapter.
- **Files:** `tests/adapters/contract.story-world-store.test.ts`
- **Deps:** T3.3
- **Acceptance:** Contract test passes against memory adapter. Can be reused for Postgres adapter later.

---

## Phase 5: Services Layer — Story Tool Server & Extraction Agent

Design: **no embedding/semantic search.** The extraction agent gets the story's entity-type registry (types + `attributeDefs`) in the system prompt and uses **Vercel AI SDK tool calling** (ai@7 `generateText` + `tools`; see T2.1/T5.4) to fetch the entities it needs — bounded, server-side (per-type `limit`, default 50, max 200) — then **stages** mutations. Nothing persists until the agent finishes; then staged ops are validated and applied through `applyCommit` → `StoryWorldStore.commit`. The executor stamps `provenance` on every fact. Contradictions surface as server-side warnings on conflicting tool writes; the agent resolves them with a `supersede_fact` call.

### T5.1 — ✅ Done Story tool catalog (definitions)
- **Scope:** Define the tool catalog. Each entry carries `description` + an **`inputSchema`** (zod 4 strict object; `describe()` supplies parameter docs — the SDK converts it via `zodSchema()`, replacing hand-written JSON-Schema `parameters`): reads — `list_entity_types(storyId)`, `get_entities(storyId, entityTypeId, limit?, offset?, query?)`, `get_entity(storyId, entityId)`, `query_events(storyId, entityId?)`; writes (staged) — `stage_create_entity_type`, `stage_create_entity`, `stage_update_entity`, `stage_create_event`, `stage_create_fact`, `stage_create_relationship`, `stage_update_knowledge`, `stage_resolve_open_question`, `supersede_fact`; terminal — `finish`. Reads hit the store directly; writes stage ops in the session (nothing persists until `finish`). `get_entities` honors `limit` server-side (default 50, max 200). Budget constants (`MAX_TOOL_CALLS=40`, `MAX_FETCHES=200`) live here. `src/services/llm-agent/tools/sdk.ts` bridges the catalog into an SDK `ToolSet` (`ai.tool({ description, inputSchema, execute })`, delegating to T5.2).
- **Files:** `src/services/llm-agent/tools/definitions.ts`, `src/services/llm-agent/tools/sdk.ts`
- **Deps:** T2.3, T1.2
- **Acceptance:** Catalog compiles; every tool has a handler in T5.2. Prompt snapshot asserts bounds are declared ("max 200").

### T5.2 — ✅ Done Story tool executor
- **Scope:** Implement `executor(session, toolCall): Promise<ToolResult>` — executes a call against the current staged world. Reads resolve via `StoryWorldStore`; writes validate (unknown entity/type id → corrective error result so the model self-corrects; attributes validated via `validateEntity`; duplicate entity names flagged; conflicting write returns a `contradiction` warning naming the existing fact). `supersede_fact` target must exist. Tracks `toolCalls`/`fetchedEntities` counters. Staged entities get stable session ids so later reads/updates can reference them before commit.
- **Files:** `src/services/llm-agent/tools/executor.ts`
- **Deps:** T5.1, T1.6
- **Acceptance:** Unit test: `get_entities` caps at `limit`; invalid attribute → corrective error; duplicate entity flagged; superseding an unknown fact id rejected.

### T5.3 — ✅ Done Commit builder from staged ops
- **Scope:** Implement `CommitBuilder.buildFromStaged(store, session, options)` — converts staged ops to a domain `Commit`, stamps `provenance` (`{ dictationId, textChunk, confidence }`) on every fact, then runs it through `applyCommit` (T1.11) as the single validation gate and persists via `StoryWorldStore.commit`. Extension: `Commit` gained `resolvedOpenQuestionIds` + `CommitResult.openQuestionsResolved` so `stage_resolve_open_question` has a home in the append-only reducer (`applyCommit` marks existing questions resolved).
- **Files:** `src/services/llm-agent/tools/build-commit.ts`, `src/domain/commits.ts`
- **Deps:** T1.7, T2.3
- **Acceptance:** Staged create/update/fact ops produce a valid `CommitResult` with correct counts; invalid ops rejected.

### T5.4 — ✅ Done Extraction agent loop (TranscriptProcessor)
- **Scope:** Implement `TranscriptProcessor` as a **constructor-DI service**: takes `ExtractionDeps { model, store }` in its constructor and is bound in the composition root `buildContainer` as `TRANSCRIPT_PROCESSOR` (`buildContainer` resolves `createLanguageModel(CONFIG)` + `STORY_WORLD_STORE` via a lazy factory). `process(job: ExtractionJob): Promise<ProcessTranscriptResult>` (per-chunk `ChunkTrace` list + aggregated `commitResults`):
  1. Load story (`StoryWorldStore`; transcript arrives on the `ExtractionJob` payload — no extra `TranscriptStore` hop).
  2. System prompt = registry (entity types + `attributeDefs`) + tool rules + bounds; user message = transcript (chunked at ~16k chars via `chunkText`).
  3. **Drive the loop with the Vercel AI SDK:** `buildStoryTools` (T5.1) exposes the catalog as `ai.tool`s (`inputSchema: zodSchema(def.inputSchema)`); `runChunk` calls `generateText({ model, system, prompt, tools, temperature: 0, stopWhen: [stepCountIs(40), hasToolCall('finish'), tool/fetch counter conditions] })`. The SDK validates tool inputs, assembles tool calls + results across steps, and terminates on `finish` or budget exhaustion (≤ 40 tool calls, ≤ 200 fetches per chunk); each accepted call still runs through the T5.2 executor.
  4. On the final step (no tool calls, or `finish`) → T5.3 build + commit → `CommitResult` (per chunk); `stoppedReason` reports `finished` / `tool-call-limit` / `fetch-limit` / `no-tool-calls`.
  5. Empty transcript (or a chunk that stages nothing) → no-op with no commit.
- **Files:** `src/services/llm-agent/transcript-processor.ts`, `src/services/llm-agent/tools/sdk.ts`, `src/container/registry.ts`, `src/container/index.ts`
- **Deps:** T5.1–T5.3, T2.1, T2.3
- **Acceptance:** Integration test with memory adapters: canned transcript → `CommitResult` with correct counts; scripted AI SDK model (`tests/mocks/sdk-model.ts`) scripts tool calls for determinism; no real provider calls. Container test: `container.get('TRANSCRIPT_PROCESSOR')` returns a singleton with injected `model` + `store`.

### T5.5 — ✅ Done Extraction agent tests
- **Scope:** Vitest tests for `TranscriptProcessor.process(job)` (`tests/services/llm-agent/transcript-processor.test.ts`, scripted AI SDK model) plus direct executor tests (`tests/services/llm-agent/tools/executor.test.ts`): normal extraction; empty transcript (no-op); model stops without tools (no-op); **brand-new entity type** introduced (registering a `starship` type in-session and referencing it); contradiction → old fact superseded via `supersede_fact`; tool-call budget exceeded → graceful stop with partial commit; fetch budget exceeded on `get_entities` → graceful stop.
- **Files:** `tests/services/llm-agent/transcript-processor.test.ts`, `tests/services/llm-agent/tools/executor.test.ts`, `tests/mocks/sdk-model.ts`, `tests/adapters/llm-provider.test.ts`
- **Deps:** T5.4, T3.6
- **Acceptance:** All tests pass. 105 tests green; typecheck + lint clean.

---

## Phase 6: Services Layer — Bounded Context Assembly (reasoning)

Design: the extraction path no longer builds context (the agent fetches via tools). This phase provides bounded, schema-rendered context for the **reasoning** features (ask/analyze): match mentions against names + aliases across all types, render attributes per `attributeDefs`, cap tokens. No embeddings, no vector search.

### T6.1 — ContextBuilder (registry-bounded)
- **Scope:** Implement `buildContext(storyId, mentions: string[]): Promise<ContextPackage>` — resolves mentions against names + aliases across ALL types (bounded to ≤ 10 matches), renders each entity's attributes per its `attributeDefs`, attaches relationships, recent events (last 10), knowledge claims, open questions. Caps output at ~3–4k tokens.
- **Files:** `src/services/context/builder.ts`
- **Deps:** T2.3, T1.6
- **Acceptance:** Integration test: world with 5 characters + 2 starships, mentions of a character + a starship → context contains only those + their relations + declared attributes. Token cap respected (words × 1.3 as proxy).

### T6.2 — ContextBuilder token cap test
- **Scope:** Create a large fictional world (80k words equivalent) and assert `buildContext` output stays under 4k tokens.
- **Files:** `tests/services/context/builder.test.ts`
- **Deps:** T6.1
- **Acceptance:** Test passes. Cost guard verified.

### T6.3 — Entity mention parser
- **Scope:** Implement `parseMentions(text: string, existingEntities: Entity[]): string[]` — regex/heuristic: case-insensitive, longest-match substring against known names + aliases, **across all entity types**.
- **Files:** `src/services/context/mention-parser.ts`
- **Deps:** T1.2
- **Acceptance:** "Sarah walked onto the Relentless bridge" + world containing character `Sarah` and starship `The Relentless` → `["Sarah", "The Relentless"]`. Handles aliases.

---

## Phase 7: Services Layer — Reasoning

### T7.1 — "Ask my story anything"
- **Scope:** Implement `askStory(deps, storyId, question): Promise<string>`. Parse mentions from the question (T6.3), build bounded context via ContextBuilder (T6.1), format into a prompt, call `standard`-tier LLM, return the answer.
- **Files:** `src/services/reasoning/ask.ts`
- **Deps:** T6.1, T2.1
- **Acceptance:** Unit test: given a world where "Sarah knows John killed Michael", question "Does Sarah know who killed Michael?" → answer includes "yes".

### T7.2 — Knowledge query: "Does character X know fact Y?"
- **Scope:** Implement `doesEntityKnow(storyId, entityId, factDescription): Promise<KnowledgeStatus>`. Queries the `knowledge` table for the entity + matching fact, considers timeline (what has the entity learned by this point in the story).
- **Files:** `src/services/reasoning/knowledge.ts`
- **Deps:** T2.3, T1.4
- **Acceptance:** Unit test: Sarah learned "John killed Michael" in chapter 8. Query at chapter 10 → known. Query at chapter 5 → unknown.

### T7.3 — Continuity checker
- **Scope:** Implement `checkContinuity(storyId, analysisType): Promise<ContinuityReport[]>`. Analysis types: `all`, `contradictions`, `anachronisms`, `motivation-gaps`, `relationship-state`, `dangling-threads`. Uses `best`-tier LLM with selective context.
- **Files:** `src/services/reasoning/continuity.ts`
- **Deps:** T2.1, T2.3, T6.1
- **Acceptance:** Unit test: world with Sarah having green eyes ch.2 and blue eyes ch.14 → contradiction detected. Dangling thread (photograph introduced ch.3, not referenced for 11 chapters) detected.

### T7.4 — Reasoning barrel export
- **Scope:** Re-export `askStory`, `doesEntityKnow`, `checkContinuity` from `src/services/reasoning/index.ts`.
- **Files:** `src/services/reasoning/index.ts`
- **Deps:** T7.1–T7.3
- **Acceptance:** Imports work.

---

## Phase 8: Database (Drizzle + Postgres)

### T8.1 — ✅ Done Drizzle schema
- **Scope:** Define all tables from IMPLEMENTATION.md §6 as Drizzle `pgTable` definitions. Include proper types: `jsonb` for arrays/objects, `uuid` primary keys, `text` for confidence enums, `serial` for revision bumps.
- **Files:** `drizzle/schema.ts`, `drizzle/migrations/` (initial)
- **Deps:** T0.2
- **Acceptance:** `drizzle-kit generate` produced `0000_initial.sql`; migration applies cleanly to `novelos_test`. 14 tables + 5 pgEnums; every row carries `revision` for append-only `byRevision` (see note below).

### T8.2 — ✅ Done Postgres StoryWorldStore adapter
- **Scope:** Implement `StoryWorldStore` backed by Drizzle + Postgres. `commit` is a single transaction: insert events, upsert entities, insert facts, insert knowledge, bump story revision. `getWorld` JOINs all tables for a story. `queryEvents` filters by participants, location, time range. `byRevision` reconstructs world at a given revision (append-only with supersede).
- **Files:** `src/adapters/postgres/story-world-store.ts`
- **Deps:** T2.3, T8.1
- **Acceptance:** Passes adapter contract test from T4.5 against a real Postgres database (9 contract tests green in `tests/adapters/postgres.test.ts`).

### T8.3 — ✅ Done Postgres TranscriptStore adapter
- **Scope:** Implement `TranscriptStore` backed by Drizzle: insert/find dictations (`listDictations`, `findDictationByProviderJobId`). Note: inserts upsert a story shell first — `dictations.story_id` FKs `stories`, so the story row must exist before saving a dictation.
- **Files:** `src/adapters/postgres/transcript-store.ts`
- **Deps:** T2.4, T8.1
- **Acceptance:** Passes adapter contract test (round-trip green in `tests/adapters/postgres.test.ts`).

### T8.4 — ✅ Done Postgres adapter barrel + migration runner
- **Scope:** Re-export from `src/adapters/postgres/index.ts`. Create `drizzle/migrate.mts` script for CI/production (`tsx` under CJS rejects top-level `await` in `.ts`, hence `.mts`).
- **Files:** `src/adapters/postgres/index.ts`, `drizzle/migrate.mts`
- **Deps:** T8.2, T8.3
- **Acceptance:** `npm run db:migrate` runs without error against test DB (idempotent; `drizzle.__drizzle_migrations` = 2 rows).

### T8.5 — ✅ Done Production buildContainer
- **Scope:** Update `buildContainer` in `src/container/index.ts` to instantiate real Postgres adapters when `DATABASE_URL` is set. Real LLM adapter (T9.x) when `LLM_API_KEY` is set. SQS queue adapter (T11.x) when `SQS_QUEUE_URL` is set. Each missing env skips that adapter with a clear error.
- **Files:** `src/container/index.ts`
- **Deps:** T8.2–T8.4, T4.3
- **Acceptance:** `buildContainer(loadConfig({ DATABASE_URL: '...' }))` returns a container with real `StoryWorldStore`. Deviation: missing adapters bind **lazy** factories that throw a descriptive `NotImplementedError` on resolve (STT→AssemblyAI, LLM non-openai→LLM_PROVIDER=openai, JOB_QUEUE→SQS), not at binding time.

---

## Phase 9: OpenAI LLM Adapter

### T9.1 — ✅ Done Real LLM provider (`createLanguageModel` + OpenAI `LlmClient`)
- **Scope:** Two real-provider paths ship together:
  - `createLanguageModel(config)` in `src/adapters/llm-provider.ts` — switches on `LLM_PROVIDER`: `createOpenAI({ apiKey }).languageModel(config.LLM_STANDARD_MODEL)` for `openai`, `createAnthropic({ apiKey }).languageModel(...)` for `anthropic`, `mock` → `NotImplementedError` (scripted models live in `tests/mocks`).
  - `OpenAiLlm` (T9.1 origin spec) in `src/adapters/openai/llm-client.ts` — `LlmClient`-backed: `complete` sends `generateText`; `extractStructured` sends JSON-mode `generateObject` + Zod parse with **one parse-failure re-prompt**; tier routing `cheap`/`standard`/`best` → `gpt-5-nano`/`gpt-5-mini`/`gpt-5-pro` (overridable per-tier via `LLM_*_MODEL` config). Missing AI SDK token usage (`number | undefined`) coalesces to 0. `modelForTier` is an injectable test seam.
- **Files:** `src/adapters/llm-provider.ts`, `src/adapters/openai/llm-client.ts`, `src/adapters/index.ts`, `tests/adapters/llm-provider.test.ts`, `tests/adapters/openai.test.ts`
- **Deps:** T2.1, T1.6, T5.4
- **Acceptance:** Provider tests assert `provider` starts with `openai`/`anthropic` and `modelId === 'gpt-5-mini'`; `createLanguageModel({ LLM_PROVIDER: 'mock' })` throws with a pointer to `tests/mocks`. Adapter tests (scripted `MockLanguageModelV4`) cover `complete` text+usage, `extractStructured` parse+validate, exactly-one retry on parse failure, and re-throw when the repair also fails.

### T9.2 — ✅ Done OpenAI adapter barrel export
- **Scope:** `src/adapters/openai/index.ts` re-exports `OpenAiLlm` + `openaiLlm` factory; the top-level `src/adapters/index.ts` barrel re-exports them too.
- **Files:** `src/adapters/openai/index.ts`, `src/adapters/index.ts`
- **Deps:** T9.1
- **Acceptance:** `import { openaiLlm } from '@/adapters/openai'` works.

### T9.3 — ✅ Done Production buildContainer wiring for OpenAI
- **Scope:** `buildContainer` binds `LLM` to `openaiLlm({ apiKey, models: { cheap/standard/best from LLM_*_MODEL } })` when `LLM_PROVIDER=openai`; any other provider resolves a lazy `NotImplementedError` referencing `LLM_PROVIDER=openai` (T9.1). The extraction loop already resolves a real `LanguageModel` via `createLanguageModel`/`LLM_PROVIDER`.
- **Files:** `src/container/index.ts`, `tests/container-memory.test.ts`
- **Deps:** T9.2
- **Acceptance:** Adapter tests + container test assert `container.get("LLM")` exposes `complete`/`extractStructured` (T9.3 test uses an injected scripted model, so no live OpenAI key is required). End-to-end `TranscriptProcessor` run against live OpenAI needs a real `LLM_API_KEY` (manually verified, not in CI).

---

## Phase 10: AssemblyAI STT Adapter

### T10.1 — ✅ Done AssemblyAI STT adapter
- **Scope:** Implement `SpeechToText` backed by AssemblyAI. `submitTranscription` uploads audio and submits a transcript job with `webhookUrl`; it returns the **`transcript_id`** — the correlation key persisted as `providerJobId` on the dictation row. Uses AssemblyAI webhook auth (`webhook_auth_header_name` + `webhook_auth_header_value` echoing `WEBHOOK_SECRET`) so callbacks can be trusted. `getTranscript` fetches by transcript id. Handle: queued → processing → done/error states.
- **Files:** `src/adapters/assemblyai/stt.ts`
- **Deps:** T2.2
- **Acceptance:** Adapter tests (`tests/adapters/assemblyai.test.ts`, 6 tests) drive a fake AssemblyAI REST API via the injected `fetch` seam — covers upload+submit with webhook echo, webhook-field omission, queued→processing→completed, error→failed, word segments + duration, 4xx upload rejection (`AssemblyAiError`).
- **Deviation:** implemented against the v2 REST API with native `fetch` (no `assemblyai` SDK dep); the SDK is a thin wrapper over the same endpoints, and `baseUrl`/`fetch` seams allow offline testing and a self-hosted relay.

### T10.2 — ✅ Done AssemblyAI adapter barrel export
- **Scope:** Re-export from `src/adapters/assemblyai/index.ts`.
- **Files:** `src/adapters/assemblyai/index.ts` (+ re-exported from `src/adapters/index.ts`)
- **Deps:** T10.1
- **Acceptance:** `import { assemblyaiStt } from '@/adapters/assemblyai'` works. `buildContainer` binds `STT` to `assemblyaiStt({ apiKey: STT_API_KEY })` when `STT_PROVIDER=assemblyai`; other providers resolve a lazy `NotImplementedError` pointing at `STT_PROVIDER=assemblyai`.

---

## Phase 11: AWS SQS Job Queue Adapter

SQS replaces Redis/BullMQ (fully managed, nothing to run, DLQ + visibility-timeout retries built in). Rate limiting to AssemblyAI is done on the **consumer side** with a bounded `maxConcurrency` (SQS has no server-side rate limiter — AssemblyAI is account-rate-limited).

### T11.1 — ✅ Done SQS JobQueue adapter
- **Scope:** Implement `JobQueue` backed by AWS SQS with `@aws-sdk/client-sqs`. `enqueue` sends a `{ jobName, data }` message (jobName also a message attribute) to the queue configured by `SQS_QUEUE_URL`. The consumer long-polls `ReceiveMessage` and dispatches to the registered handler under a `maxConcurrency` bound (the AssemblyAI account rate limit); processed messages are deleted, failed jobs go to the DLQ when configured. `getStatus` tracks job state against the returned message ids. Connection errors degrade to an in-process queue in `local-fallback` mode (dev) with a logged warning, or throw in `strict` mode. Polling starts explicitly via `start()` (worker-only), with `stop()` graceful shutdown.
- **Files:** `src/adapters/sqs/job-queue.ts`
- **Deps:** T2.5
- **Acceptance:** Adapter tests (`tests/adapters/sqs.test.ts`, 8 tests) run against a fake SQS client (injected seam) covering: enqueue payload/attribute, enqueue+consume round-trip + delete, failure→onJobFailed + delete, DLQ move, `maxConcurrency` under a 5-job burst (peak ≤ bound), unknown-job abandonment, local-fallback resilience, strict-mode rethrow. LocalStack e2e remains a manual/ops verification.

### T11.2 — ✅ Done Worker entry point
- **Scope:** Create `workers/index.ts` that boots an SQS consumer for the `extraction` job type. Worker uses `buildContainer(process.env)` and calls `container.get('TRANSCRIPT_PROCESSOR').process(job)`. Handles graceful shutdown (SIGTERM).
- **Files:** `workers/index.ts` (+ `worker` npm script → `tsx workers/index.ts`)
- **Deps:** T11.1, T5.4, T4.3
- **Acceptance:** `npm run worker` (with `DATABASE_URL` + `SQS_QUEUE_URL` + real keys in env) starts the extraction consumer; SIGTERM/SIGINT drains in-flight handlers before exit.

### T11.3 — ✅ Done SQS adapter barrel export
- **Scope:** Re-export from `src/adapters/sqs/index.ts`.
- **Files:** `src/adapters/sqs/index.ts` (+ re-exported from `src/adapters/index.ts`; `buildContainer` binds `JOB_QUEUE` to `SqsJobQueue` when `SQS_QUEUE_URL` is set, else lazy `NotImplementedError`)
- **Deps:** T11.1
- **Acceptance:** `import { sqsQueue } from '@/adapters/sqs'` works.

---

## Phase 12: API Routes

### T12.1 — POST /api/dictations ✅ Done
- **Scope:** Accept `multipart/form-data` with audio file + `storyId`. Authenticated user's `userId` comes from the session, not the form. Save audio to temp storage, create a dictation row (`saveDictation({ storyId, userId, status: 'pending' })`), submit to AssemblyAI with a **clean webhook URL (no query params)**, persist the returned `transcript_id` as `providerJobId`, return `{ dictationId, jobId }`. User attribution lives in the DB row, keyed by `transcript_id`, never in the webhook URL.
- **Files:** `app/api/dictations/route.ts`
- **Deps:** T2.5, T2.4, T4.4
- **Acceptance:** `curl -F "audio=@test.mp3" -F "storyId=abc" -H "x-user-id: u1" localhost:3000/api/dictations` returns `{ jobId: "..." }`; the dictation row carries `userId = "u1"` and the AssemblyAI `transcript_id` as `providerJobId`.

### T12.2 — GET /api/dictations/[id] ✅ Done
- **Scope:** Return dictation job status + `CommitResult` summary when complete.
- **Files:** `app/api/dictations/[id]/route.ts`
- **Deps:** T12.1
- **Acceptance:** After processing completes, GET returns `{ status: "completed", summary: { events: 3, ... } }`.

### T12.3 — GET /api/stories/[id] ✅ Done
- **Scope:** Return full `StoryWorld` for a story.
- **Files:** `app/api/stories/[id]/route.ts`
- **Deps:** T2.3
- **Acceptance:** Returns JSON with all entities, events, facts, knowledge, etc.

### T12.4 — PATCH /api/stories/[id]/entities/[entityId] ✅ Done
- **Scope:** Manual entity edit. Accepts partial attribute updates over `Entity` (`attributes`, `aliases`, `media`) — validated against the entity's `EntityType` def (`validateAttributes`/`validateEntity`). Applies via `commit` with `confidence: explicit`.
- **Files:** `app/api/stories/[id]/entities/[entityId]/route.ts`
- **Deps:** T2.3
- **Acceptance:** PATCH updates entity attributes, bumps revision, logs to revisions table.

### T12.5 — POST /api/stories/[id]/ask ✅ Done
- **Scope:** Accept `{ question: string }`, return `{ answer: string }`. Calls `askStory` from reasoning layer.
- **Files:** `app/api/stories/[id]/ask/route.ts`
- **Deps:** T7.1
- **Acceptance:** POST with a question returns a contextual answer from the story world.

### T12.6 — POST /api/stories/[id]/analyze ✅ Done
- **Scope:** Accept `{ analysisType: string }`, return `{ reports: ContinuityReport[] }`. Calls `checkContinuity`.
- **Files:** `app/api/stories/[id]/analyze/route.ts`
- **Deps:** T7.3
- **Acceptance:** POST with `analysisType: "contradictions"` returns contradiction reports.

### T12.7 — POST /api/stories/[id]/knowledge ✅ Done
- **Scope:** Accept `{ entityName, factDescription }`, return `{ status: 'known'|'unknown', context: string }`. Calls `doesEntityKnow`.
- **Files:** `app/api/stories/[id]/knowledge/route.ts`
- **Deps:** T7.2
- **Acceptance:** Returns correct knowledge status.

### T12.8 — POST /api/stories/[id]/entity-types (user-created types) ✅ Done
- **Scope:** Accept `{ name, pluralName, baseKind, description, attributeDefs }` → registers a new `EntityType` via `upsertEntityType` with `origin: 'user'`. Validate `name` uniqueness, `baseKind` from `BASE_KIND_CATALOG`, and attribute defs via the Zod schemas. This is the "user creates a type" flow of §5.3.
- **Files:** `app/api/stories/[id]/entity-types/route.ts`
- **Deps:** T2.3, T1.1
- **Acceptance:** POST a `starship` type with `baseKind: 'physical'` → appears in `GET /api/stories/[id]` registry and in the sidebar sections. Invalid `baseKind` → 400.

### T12.9 — POST /api/stories/[id]/entities/[entityId]/media ✅ Done
- **Scope:** Accept `multipart/form-data`: file + `role` (`portrait` | `gallery`) + optional `caption`. Store file, call `attachMedia`. **Reject with 400 when the entity's `baseKind.supportsMedia` is false** (abstract types are text-only). Enforce one `portrait` per entity (new portrait replaces old).
- **Files:** `app/api/stories/[id]/entities/[entityId]/media/route.ts`
- **Deps:** T2.3, T1.2
- **Acceptance:** Upload a photo to a character → shows in portrait slot; upload to `planet` → gallery; upload to `faction` (abstract) → 400.

### T12.10 — POST /api/hooks/stt-callback ✅ Done
- **Scope:** AssemblyAI webhook endpoint. Verify the callback carries `WEBHOOK_SECRET` (AssemblyAI `webhook_auth_header_name`/`value`) → 401 otherwise. **Never trust URL params or the body for user/story identity**: resolve `transcript_id` → dictation via `findDictationByProviderJobId`, then update the dictation, fetch the transcript via `getTranscript`, set `status`, and enqueue the `extraction` job carrying `{ dictationId, storyId }`. Ownership checks (`userId`) are enforced in the route/auth layer.
- **Files:** `app/api/hooks/stt-callback/route.ts`
- **Deps:** T10.1, T5.4, T2.4
- **Acceptance:** A callback for an unknown `transcript_id` → 404; a callback without the webhook secret → 401; a valid callback marks the matching user's dictation completed and enqueues extraction.

---

## Phase 13: UI — MVP Screens

### T13.1 — Layout + left rail navigation ✅ Done
- **Scope:** Create `app/(studio)/layout.tsx` with persistent left sidebar. Top: Manuscript / Talk. Core entity sections: Characters / Places / Relationships / Timeline / Secrets / Knowledge / Goals / Open Questions / Plot Threads. Below them: **dynamic entity sections derived from the registry** (each `entityTypes.pluralName`, e.g. "Starships", "Factions") from `GET /api/stories/[id]`. Use Tailwind. Mobile-responsive (sidebar collapses to hamburger).
- **Files:** `app/(studio)/layout.tsx`, `src/ui/sidebar.tsx`
- **Deps:** T0.1
- **Acceptance:** Layout renders. Sidebar links navigate between sections.

### T13.2 — /talk screen: mic capture + upload ✅ Done
- **Scope:** Create `app/(studio)/talk/page.tsx`. MediaRecorder API for mic capture. On stop, upload audio blob to `POST /api/dictations`. Show upload progress. Display `{ jobId }` returned.
- **Files:** `app/(studio)/talk/page.tsx`, `src/ui/mic-capture.tsx`
- **Deps:** T12.1
- **Acceptance:** Click mic → record → stop → upload → see job ID. Browser mic permission prompt works.

### T13.3 — /talk screen: processing status + result card ✅ Done
- **Scope:** Poll `GET /api/dictations/[id]` every 2s. Show spinner during processing. On complete, display result card: "Processed N words — Added: {per-entity-type counts}, {events} events, {scenes} scenes, ⚠️ {N} contradictions" (counts from `CommitResult.entitiesCreatedByType`, e.g. "Added: 2 starships, 3 events"). Show contradiction warnings prominently.
- **Files:** `app/(studio)/talk/page.tsx`, `src/ui/result-card.tsx`
- **Deps:** T12.2, T13.2
- **Acceptance:** After upload, status updates in real-time. Result card shows correct counts. Contradiction warning is visible.

### T13.4 — /story screen: entity list + detail pane ✅ Done
- **Scope:** Create `app/(studio)/story/page.tsx`. Fetches `GET /api/stories/[id]`. Left sub-nav built from the registry: core sections (Characters / Places / Relationships / Timeline / Secrets / Knowledge / Goals / Open Questions / Plot Threads) plus one section per registered entity type (pluralName). Right pane: detail for selected entity. Each entity card/panel renders **declared attributes only** (from `attributeDefs`) — schema-driven, with a media section when `baseKind.supportsMedia`. No per-kind branches.
- **Files:** `app/(studio)/story/page.tsx`, `src/ui/entity-list.tsx`, `src/ui/entity-detail.tsx`
- **Deps:** T12.3
- **Acceptance:** Selecting a character shows their full attribute sheet (sub-sections: knowledge by timeline, interactions, appearances, contradictions — core flow). Selecting a place shows its events. Selecting a `starship` shows class/armament/captain and its gallery.

### T13.5 — /character/[id] screen ✅ Done
- **Scope:** Create `app/(studio)/character/[id]/page.tsx`. Full **core** character sheet (this is a core flow): portrait (upload → `POST /api/stories/[id]/entities/[entityId]/media`), name, aliases, goals, fears, desires, beliefs, secrets, appearance, personality, backstory. Sub-sections: Knowledge by timeline, Interactions, Appearance history, Contradictions. (Dynamic entity types share the generic `entity-detail`, not this page.)
- **Files:** `app/(studio)/character/[id]/page.tsx`, `src/ui/character-sheet.tsx`
- **Deps:** T12.3
- **Acceptance:** Navigating to `/character/sarah-id` shows Sarah's full sheet with all attributes populated.

### T13.6 — /scene/[id] screen ✅ Done
- **Scope:** Create `app/(studio)/scene/[id]/page.tsx`. Scene card: setting (any entity — place, planet, landscape), time, participants present, what happened, what changed, involved objects, knowledge gained, knowledge concealed, conflict.
- **Files:** `app/(studio)/scene/[id]/page.tsx`, `src/ui/scene-card.tsx`
- **Deps:** T12.3
- **Acceptance:** Scene detail renders with all fields.

### T13.7 — /ask screen ✅ Done
- **Scope:** Create `app/(studio)/ask/page.tsx`. Chat-style interface: user types question, POST to `/api/stories/[id]/ask`, display answer. Show loading state during LLM call.
- **Files:** `app/(studio)/ask/page.tsx`, `src/ui/ask-chat.tsx`
- **Deps:** T12.5
- **Acceptance:** Type a question, get a contextual answer from the story world.

### T13.8 — /debug screen ✅ Done
- **Scope:** Create `app/(studio)/debug/page.tsx`. Dropdown to select analysis type (contradictions / anachronisms / motivation-gaps / relationship-state / dangling-threads / all). POST to `/api/stories/[id]/analyze`. Display reports as cards with severity indicators.
- **Files:** `app/(studio)/debug/page.tsx`, `src/ui/debug-reports.tsx`
- **Deps:** T12.6
- **Acceptance:** Selecting "contradictions" and clicking Analyze shows contradiction reports.

---

## Phase 16: Manual Authoring & Direct Entity Creation

Design: three authoring modes run in parallel — (a) voice dictation → LLM extraction (existing), (b) typed text → LLM extraction (same pipeline, no STT hop), (c) direct form-based entity creation (no LLM at all). All three commit through the same `StoryWorldStore.commit` path. Builtin entity types (character/place/object) are auto-registered on first direct-create. Media upload (portrait + gallery) is available for all `supportsMedia` base kinds directly from the entity detail and character sheet.

### T16.1 — POST /api/stories/[id]/extract-text ✅ Done
- **Scope:** Accept `{ text: string }`. Create a dictation row (`status: "processing"`, `transcript: text`), run `TranscriptProcessor.process()` synchronously (no STT hop — text arrives pre-transcribed), update the row to `completed`/`failed` with the `CommitResult` summary, return `{ dictationId }`. The same `GET /api/dictations/[id]` polling endpoint works unchanged.
- **Files:** `src/app/api/stories/[id]/extract-text/route.ts`
- **Deps:** T5.4, T12.1, T12.2
- **Acceptance:** POST `{ text: "Sarah walked into the bridge..." }` → `{ dictationId }` → poll → `{ status: "completed", summary: {...} }`.

### T16.2 — POST /api/stories/[id]/entities (direct entity creation) ✅ Done
- **Scope:** Accept `{ name, entityTypeName, aliases?, attributes? }`. Looks up entity type in the world's registry (case-insensitive); if the type is a builtin (character/place/object) and not yet registered for this story, auto-registers it via `upsertEntityType` (creating the story shell if needed). Validates attributes against the type's `attributeDefs`, builds a `Commit`, and calls `store.commit()`. Returns the created entity. No LLM involved.
- **Files:** `src/app/api/stories/[id]/entities/route.ts`
- **Deps:** T2.3, T1.2, T12.3
- **Acceptance:** POST `{ name: "Sarah", entityTypeName: "character" }` to a fresh story → entity created, story world exists, revision = 1. Invalid attributes → 400. Unknown non-builtin type → 404.

### T16.3 — Talk screen: "Write" tab ✅ Done
- **Scope:** Add a "Speak / Write" tab pair to the Talk screen. The "Write" tab shows a plain textarea + submit button; on submit it POSTs to `POST /api/stories/[id]/extract-text`. The existing ResultCard + polling flow is reused unchanged. The mic capture moves under the "Speak" tab.
- **Files:** `src/ui/talk-screen.tsx`
- **Deps:** T16.1, T13.2
- **Acceptance:** User can type a scene description, submit, and see the same result card as after audio dictation.

### T16.4 — Entity creation form (modal) ✅ Done
- **Scope:** Implement `EntityCreateModal` — a modal with entity type selector (registered types + builtins not yet registered), name field (required), aliases field (comma-separated), and dynamic attribute fields from `attributeDefs` (multi fields accept comma-separated values). On submit calls `POST /api/stories/[id]/entities`; on success closes and calls `onCreated`. Add a global "+ New" button in the entity list + a "create your first character" link in the empty-story missing state.
- **Files:** `src/ui/entity-create-modal.tsx`, `src/ui/entity-list.tsx`, `src/ui/story-screen.tsx`
- **Deps:** T16.2
- **Acceptance:** Click "+ New", fill name + type, submit → entity appears in the list without page reload.

### T16.5 — Media upload in entity detail + character sheet ✅ Done
- **Scope:** Implement `MediaUpload` — a reusable component (`storyId`, `entityId`, `role`, `onUploaded`). Add a media section to `EntityDetail` for entities whose `baseKind.supportsMedia` is true (portrait slot + gallery grid; each image has a remove button via PATCH media list sync). Add portrait upload to the character screen Overview tab so users can set a photo without going to Edit. Gallery images also show a remove button.
- **Files:** `src/ui/media-upload.tsx`, `src/ui/entity-detail.tsx`, `src/ui/character-screen.tsx`
- **Deps:** T12.9
- **Acceptance:** Upload portrait to a character → shows immediately in the portrait slot. Upload gallery image to a place → appears in the gallery grid. Click remove → image disappears.

---

## Phase 17: Multi-Story Dashboard, Chapters & Prose Editor, @mention System

Design: replace single-story redirect with a multi-story dashboard backed by localStorage. Introduce a per-story routing tree (`/story/[storyId]/...`) with nested layout. Add chapters and prose scenes to the data model (separate from LLM-extracted domain scenes). Implement an `@[Name](id)` mention syntax for prose that links to entities; clicking a chip opens a right-side drawer. All entity types use a single unified page (`/entity/[entityId]`).

### T17.1 — Multi-story dashboard ✅ Done
- **Scope:** Replace `app/page.tsx` redirect with a real dashboard: `useSyncExternalStore`-backed story list from localStorage + create form. Dashboard `create` calls `PATCH /api/stories/[id]` with the title before navigation so the story row is never "Untitled story". `PATCH /api/stories/[id]` handler added; `StoryWorldStore.updateStoryTitle` method added to the port + both adapters.
- **Files:** `src/app/page.tsx`, `src/ui/dashboard.tsx`, `src/app/api/stories/[id]/route.ts`, `src/container/story-world-store.ts`, `src/adapters/postgres/story-world-store.ts`, `src/adapters/mock/story-world-store.ts`
- **Acceptance:** Creating a story navigates to `/story/[id]`; story title is correct in DB on first load. Dashboard lists all stories from localStorage.

### T17.2 — Per-story routing tree + layout ✅ Done
- **Scope:** Introduce `/story/[storyId]/` route group: `layout.tsx` (sidebar + main without `lg:pl-72` double-offset), `page.tsx` (story bible), `talk/page.tsx` (narrate), `scene/[id]/page.tsx` (prose editor), `character/[id]/page.tsx` (character sheet), `entity/[entityId]/page.tsx` (unified entity page). Remove old `(studio)` group redirect.
- **Files:** `src/app/story/[storyId]/layout.tsx`, `src/app/story/[storyId]/page.tsx`, `src/app/story/[storyId]/talk/page.tsx`, `src/app/story/[storyId]/scene/[id]/page.tsx`, `src/app/story/[storyId]/character/[id]/page.tsx`, `src/app/story/[storyId]/entity/[entityId]/page.tsx`
- **Acceptance:** All routes render. Sidebar is story-scoped with no spurious left margin.

### T17.3 — Chapters & prose scenes data model ✅ Done
- **Scope:** Add `chapters` table + `scenes.(content, chapter_id, position)` columns via migrations. Define `Chapter` domain type. Extend `StoryWorldStore` with `listChapters`, `createChapter`, `updateChapter`, `deleteChapter`, `listProseScenes`, `getProseScene`, `createProseScene`, `updateProseScene`, `deleteProseScene`. Implement in both Postgres and mock adapters. Add chapter/scene CRUD API routes.
- **Files:** `drizzle/schema.ts`, `drizzle/migrations/0002_whole_clint_barton.sql`, `drizzle/migrations/0003_chapters-and-scene-content.sql`, `src/domain/chapters.ts`, `src/domain/scenes.ts`, `src/container/story-world-store.ts`, adapters, `src/app/api/stories/[id]/chapters/route.ts`, `src/app/api/stories/[id]/chapters/[chapterId]/route.ts`, `src/app/api/stories/[id]/chapters/[chapterId]/scenes/route.ts`, `src/app/api/stories/[id]/scenes/[sceneId]/route.ts`
- **Acceptance:** Create chapter → add scenes → PATCH content → GET returns updated content.

### T17.4 — Scene prose editor with @mention autocomplete ✅ Done
- **Scope:** `MentionInput` — contenteditable div that triggers an autocomplete dropdown on `@`; selects an entity and inserts `@[Name](entityId)` token; HoverCard on hover shows entity details. `SceneRenderer` parses stored content and renders tokens as styled chips. `SceneDetailScreen` wires both: 1.5s debounce autosave for content, 1s debounce for title; fires `novel-os:world-changed` when title changes to refresh the sidebar.
- **Files:** `src/ui/mention-input.tsx`, `src/ui/scene-renderer.tsx`, `src/ui/scene-detail-screen.tsx`
- **Acceptance:** Typing `@S` shows matching entities; selecting inserts the token. Saving persists content. Sidebar scene title updates within ~1s.

### T17.5 — Entity drawer on mention chip click ✅ Done
- **Scope:** `EntityDrawer` — fixed right-side panel (w-80, z-50, border-l) showing entity portrait, name, aliases, up to 6 attribute values, and "Open full page" footer link. Opens when user clicks an `@[Name]` chip (via `onEntityClick` callback threaded through `MentionInput` and `SceneRenderer`). Closes on Escape or outside click (50ms delay).
- **Files:** `src/ui/entity-drawer.tsx`, `src/ui/scene-detail-screen.tsx`, `src/ui/mention-input.tsx`, `src/ui/scene-renderer.tsx`
- **Acceptance:** Clicking an @-mention chip slides in the drawer. Escape or outside click closes it.

### T17.6 — Unified entity page for all entity types ✅ Done
- **Scope:** `EntityScreen` — Overview (attributes, media, relationships/facts for characters), Edit (`EntityDetail`), and References (`EntityReferences`) tabs for any entity type. `EntityReferences` lists prose scenes that @-mention the entity via `GET /api/stories/[id]/entities/[entityId]/references`. All entity links (sidebar, entity-list, HoverCards) route to `/story/[storyId]/entity/[entityId]`. Characters filter pill restored in the story bible.
- **Files:** `src/ui/entity-screen.tsx`, `src/ui/entity-references.tsx`, `src/app/story/[storyId]/entity/[entityId]/page.tsx`, `src/app/api/stories/[id]/entities/[entityId]/references/route.ts`, `src/ui/entity-list.tsx`
- **Acceptance:** `/story/[id]/entity/[entityId]` renders for any type. References tab shows mentioning scenes. Characters tab appears in entity-list filter pills.

### T17.7 — Chapter create modal + sidebar enhancements ✅ Done
- **Scope:** `ChapterCreateModal` — proper modal with title input replaces `window.prompt()`. Sidebar chapters section has a `+` button that opens the modal. Sidebar listens for `novel-os:world-changed` events to refresh chapters/scenes/entities without a full page reload.
- **Files:** `src/ui/chapter-create-modal.tsx`, `src/ui/sidebar.tsx`
- **Acceptance:** Clicking `+` opens the modal. After creation, sidebar chapters list updates.

### T17.8 — Story title inline editing + auto-sync ✅ Done
- **Scope:** `StoryScreen` renders the title as an `<input>` with 1s debounce autosave via `PATCH /api/stories/[id]`; fires `novel-os:world-changed` and `reload()` on save. Auto-sync `useEffect`: if the DB title is "Untitled story", reads localStorage and silently patches. All hooks moved before early returns (Rules of Hooks fix). Empty-state copy updated to "Narrate" (was "Talk").
- **Files:** `src/ui/story-screen.tsx`
- **Acceptance:** Editing the title saves to DB. Sidebar and story bible reflect the new title within ~1s. No story ever shows "Untitled story" after creation.

### T17.9 — Mock adapters relocated to src/adapters/mock ✅ Done — ⚠️ Superseded by T19.1
- **Scope:** Move mock adapters from `tests/mocks/` to `src/adapters/mock/` so the dev server can import them without crossing the `src/tests` boundary. Add `src/adapters/mock/container.ts` (moved from `tests/mocks/memory-container.ts`) and `src/adapters/mock/index.ts` barrel. Update all import paths in tests.
- **Files:** `src/adapters/mock/`, `src/adapters/index.ts`, test import paths
- **Acceptance:** `import { MockStoryWorldStore } from "@/adapters/mock"` works. All existing tests pass.
- **Note:** This decision is reversed by T19.1 — mocks belong in `tests/` only; the dev fallback is removed entirely by T19.2.

---

## Phase 18: Unified Story Persistence

Design: the story list and story data must live in the same store. Currently the dashboard stores story IDs + titles in `localStorage` while story contents live in Postgres (or the in-memory mock). This means stories "survive" a server restart on the client but their data is gone on the server — inconsistent regardless of which backend is active. The fix: remove localStorage from the dashboard, add `listStories`/`createStory` to `StoryWorldStore`, expose them via API routes, and fetch the list from the server.

### T18.1 — Add `StoryMeta`, `listStories`, `createStory` to StoryWorldStore port + adapters
- **Scope:** Add `StoryMeta { id: string; title: string; createdAt: Date }` to `src/domain/story-world.ts`. Extend `StoryWorldStore` port with `listStories(ownerId: string): Promise<StoryMeta[]>` and `createStory(id: string, data: { title: string; ownerId: string }): Promise<void>` (idempotent — ON CONFLICT DO NOTHING in Postgres). Implement in the Postgres adapter (SELECT from `stories` WHERE `owner_id`; INSERT with supplied UUID) and in the mock adapter (`tests/mocks/story-world-store.ts` — maintain an owned-stories list alongside `worlds`).
- **Files:** `src/domain/story-world.ts`, `src/container/story-world-store.ts`, `src/adapters/postgres/story-world-store.ts`, `tests/mocks/story-world-store.ts`
- **Deps:** T17.1, T8.2, T19.1
- **Acceptance:** `createStory` called twice with the same id does not throw. `listStories(ownerId)` returns only that owner's stories ordered by `createdAt DESC`. Mock adapter passes the same assertions.

### T18.2 — GET /api/stories + POST /api/stories routes
- **Scope:** `GET /api/stories` — reads `x-user-id` header, calls `store.listStories(userId)`, returns `StoryMeta[]`. `POST /api/stories` — reads `x-user-id`, body `{ id: string; title: string }`, calls `store.createStory(id, { title, ownerId: userId })`, returns `{ id }`. `PATCH /api/stories/[id]` remains for title-only updates; it no longer doubles as lazy story creation (creation is now explicit via POST). Existing `PATCH` still calls `updateStoryTitle` which upserts the row — leave that behaviour intact as a safe fallback but document that POST is the canonical creation path.
- **Files:** `src/app/api/stories/route.ts`, `src/app/api/stories/[id]/route.ts`
- **Deps:** T18.1
- **Acceptance:** `POST /api/stories` with `{ id: "uuid", title: "My Novel" }` → 201 `{ id }`. Second POST same id → 200 (idempotent). `GET /api/stories` returns the story. Missing `x-user-id` → 400.

### T18.3 — Dashboard: replace localStorage with server-side story list
- **Scope:** Remove all localStorage logic from `src/ui/dashboard.tsx` (`STORIES_KEY`, `useSyncExternalStore`, `writeStories`, `snapshotStories`, module-level cache vars). Replace with a `useEffect` + `fetch("/api/stories")` load (state: `stories`, `loading`, `error`). The `create` handler generates a UUID client-side (crypto.randomUUID()), POSTs to `/api/stories` with `{ id, title }`, then navigates — no optimistic write to localStorage. Show a loading skeleton while fetching and a clear error message on failure.
- **Files:** `src/ui/dashboard.tsx`
- **Deps:** T18.2
- **Acceptance:** Story list survives a server restart (comes from DB). Creating a story in one browser tab shows up in another tab after refresh. Clearing the browser localStorage does not lose the story list.

---

## Phase 19: Mocks to tests/ Only — Remove Dev-Container Fallback

Design: T17.9 moved mock adapters into `src/` so the dev server could import them as a no-API-keys fallback. This violates the rule that mocks are test doubles only (stated in T3.6 and the original Phase 4 design). All real adapters now exist (Postgres T8.x, OpenAI T9.x, AssemblyAI T10.x, SQS T11.x). Dev only requires `DATABASE_URL`; STT/LLM/SQS resolve lazily and only throw when their specific routes are hit. The fallback is unnecessary and misleading.

### T19.1 — Move mocks back to tests/mocks/, delete src/adapters/mock/
- **Scope:** Move the real implementations from `src/adapters/mock/*.ts` back into `tests/mocks/*.ts`, replacing the re-export stubs that are there now. Files to move: `clock.ts`, `llm.ts`, `sdk-model.ts`, `stt.ts`, `story-world-store.ts`, `transcript-store.ts`, `job-queue.ts`. Restore the actual `buildMemoryContainer` implementation into `tests/mocks/memory-container.ts` (inline — no import from `src/`). Update `tests/mocks/index.ts` barrel to export directly from the local files. Delete `src/adapters/mock/` entirely. Remove the mock re-export from `src/adapters/index.ts`. Update all test files that import from `@/adapters/mock/...` to import from `../../mocks/...` (relative) or via the barrel.
- **Files:** `tests/mocks/`, `src/adapters/mock/` (deleted), `src/adapters/index.ts`, all affected test imports
- **Deps:** T17.9 (supersedes)
- **Acceptance:** No file under `src/` imports from `tests/` or contains mock/in-memory adapter implementations. `import { MockStoryWorldStore } from "tests/mocks"` works. All existing tests pass.

### T19.2 — Remove dev-container fallback from app-container.ts
- **Scope:** In `src/server/app-container.ts`, remove the try/catch in `resolveContainer()` that catches a failed `buildProductionContainer()` and falls back to `buildDevContainer()`. Remove the `buildDevContainer` import. `resolveContainer()` simply calls `buildProductionContainer()` directly — if it throws (e.g. `DATABASE_URL` missing), that error propagates as an unhandled server error with a clear message. Add a descriptive guard: if `DATABASE_URL` is absent, throw `"DATABASE_URL is required — run Postgres locally (see README) and set DATABASE_URL in .env.local"`. STT/LLM/SQS remain lazy-throw (only fail when their route is hit, not at startup), so `next dev` with only `DATABASE_URL` set is fully functional for the story/entity/chapters flows.
- **Files:** `src/server/app-container.ts`
- **Deps:** T19.1
- **Acceptance:** `next dev` without `DATABASE_URL` logs a clear startup error. With `DATABASE_URL` set and no LLM/STT keys, all world/entity/chapter routes work; `/api/stories/[id]/ask` returns 501 with "LLM_API_KEY not configured". No mock code referenced anywhere outside `tests/`.

---

## Phase 14: Tests & Verification

### T14.1 — End-to-end integration test ✅ Done
- **Scope:** Write a full pipeline test: upload audio (mock STT) → extraction (mock LLM) → verify story world updated → query knowledge → run continuity check. All using memory adapters.
- **Files:** `tests/integration/full-pipeline.test.ts`
- **Deps:** T5.4, T6.1, T7.1, T7.2, T7.3
- **Acceptance:** Test passes. Verifies the complete flow from dictation to story world query.

### T14.2 — Adapter contract tests for Postgres adapters ✅ Done
- **Scope:** Run the contract test suite (T4.5) against Postgres `StoryWorldStore` and `TranscriptStore`. Requires test database.
- **Files:** `tests/adapters/contract.postgres.test.ts`
- **Deps:** T8.2, T8.3, T4.5
- **Acceptance:** All contract tests pass against Postgres.

### T14.3 — Cost guard test ✅ Done
- **Scope:** Create a fictional 80k-word corpus (generated programmatically). Run `ContextBuilder` 100 times with random transcript chunks. Assert average context package stays under 4k tokens.
- **Files:** `tests/services/context/cost-guard.test.ts`
- **Deps:** T6.1
- **Acceptance:** Test passes. Average < 4k tokens.

### T14.4 — Contradiction edge case tests ✅ Done
- **Scope:** Test contradiction handling with: same fact restated (no contradiction flagged), contradictory facts (tool warning surfaces), supersede flow (agent calls `supersede_fact` → old claim marked superseded), implicit vs explicit (strata preserved), contradictory facts across chapters (anachronism).
- **Files:** `tests/services/llm-agent/tools/supersede.test.ts`
- **Deps:** T5.5
- **Acceptance:** All edge cases handled correctly.

### T14.5 — Lint + typecheck pass ✅ Done
- **Scope:** Run `npm run lint` and `npx tsc --noEmit` across the entire codebase. Fix all errors.
- **Files:** All
- **Deps:** All previous tasks
- **Acceptance:** Zero lint errors, zero type errors.

---

## Phase 15: Polish & Deployment

### T15.1 — Loading and error states
- **Scope:** Add loading spinners, error boundaries, and toast notifications across all API-consuming pages. Handle network errors, API errors, and empty states gracefully.
- **Files:** `src/ui/loading.tsx`, `src/ui/error-boundary.tsx`, `src/ui/toast.tsx`
- **Deps:** T13.x
- **Acceptance:** No unhandled errors in console. Error states show user-friendly messages.

### T15.2 — Responsive design pass
- **Scope:** Ensure all screens work on mobile (375px), tablet (768px), and desktop (1280px). Sidebar collapses to hamburger on mobile. Entity detail becomes full-screen on mobile.
- **Files:** All UI files
- **Deps:** T13.x
- **Acceptance:** Visual inspection on all three breakpoints.

### T15.3 — Deployment config
- **Scope:** Create `Dockerfile` (multi-stage: build + run). Create `docker-compose.yml` with Next.js app + Postgres (the SQS queue is fully managed — no local broker; LocalStack optional for T11 dev). Create `.env.production.example`. Add `scripts/` for DB migration + seeding.
- **Files:** `Dockerfile`, `docker-compose.yml`, `.env.production.example`, `scripts/seed.ts`
- **Deps:** T8.x, T11.x
- **Acceptance:** `docker-compose up` starts all services. App loads at `localhost:3000`. Migrations run automatically.

### T15.4 — README with setup instructions
- **Scope:** Write `README.md`: prerequisites, local dev setup, environment variables, database setup, running the app, running tests, architecture overview (link to IMPLEMENTATION.md).
- **Files:** `README.md`
- **Deps:** T15.3
- **Acceptance:** A new developer can clone and run the app following the README.

---

## Dependency Graph (summary)

```
T0.1 → T0.2, T0.3
T0.2 → T0.4
T0.3 → T1.1–T1.8, T2.1–T2.7
T1.x → T2.x → T3.x → T4.x
T1.6 → T5.1
T5.1–T5.3 → T5.4 → T5.5
T6.1–T6.3 → T7.x
T5.4, T6.1, T7.x → T12.x → T13.x
T11.x → T15.3
T17.9 → T19.1 (superseded)
T8.x → T18.1 → T18.2 → T18.3
T19.1 → T19.2
T19.2, T18.1 must precede any dev testing against real Postgres
All → T14.x → T15.x
```

## Parallelism opportunities

- T1.1–T1.5 can be done in parallel (independent type files)
- T2.1–T2.7 can be done in parallel (independent port files)
- T3.1–T3.6 can be done in parallel (independent memory adapters)
- T12.1–T12.10 can be done in parallel (independent API routes)
- T13.2–T13.8 can be done in parallel after T13.1 (independent pages)
- T8.1–T8.3 can be done in parallel (independent Drizzle adapters)
- T9.1, T10.1, T11.1 can be done in parallel (independent providers)
