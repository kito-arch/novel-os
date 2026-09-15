# NovelOS — PROGRESS

Live status of implementation against `ACTIONS.md`. Each phase lists tasks with status and acceptance verification. Note anything deviating from the spec under "Notes".

---

## Phase 0: Project Bootstrap — COMPLETE

| Task | Status | Notes |
| --- | --- | --- |
| T0.1 — Initialize Next.js project | ✅ Done | Next.js 16.3.5 (App Router, TypeScript, Tailwind v4, ESLint 9). `npm run dev` serves 200; `npm run lint` clean. |
| T0.2 — Install core dependencies | ✅ Done | zod, drizzle-orm, @trpc/server, uuid, nanoid, @evyweb/ioctopus + dev deps drizzle-kit, vitest, @types/node@24. |
| T0.3 — Configure path aliases | ✅ Done | `@/*` → `./src/*` (pre-set by create-next-app); domain/adapters/services barrels + `@/container` composition root created; `vitest.config.ts` alias; resolution proven in test. |
| T0.4 — Configure env and config module | ✅ Done | `src/config/index.ts` Zod-validated `loadConfig`; requires API key when a real provider is selected. |

### Acceptance verification (all pass)

- `npm run dev` starts without error — `GET / 200`.
- `npm run lint` — 0 errors.
- `npm run typecheck` — 0 errors.
- `npx vitest --run` — 3 files, 11 tests, all pass.

### Files created/changed

```
package.json                # scripts: typecheck, test added; ioctopus + data deps added
src/config/index.ts         # AppConfig, configSchema, loadConfig, EnvVars
src/domain/index.ts         # barrel (placeholder export, filled in Phase 1)
src/adapters/index.ts       # barrel (placeholder export, filled in Phase 3+)
src/services/index.ts    # barrel (placeholder export, filled in Phase 5+)
src/container/index.ts      # ioctopus composition root: AppRegistry, createAppModule, buildContainer
tests/bootstrap.test.ts     # proves @/ alias resolves to all barrels
tests/container.test.ts     # proves ioctopus binds/resolves CONFIG with full type safety
tests/config.test.ts        # Zod validation + defaults + conditional-required keys
vitest.config.ts            # node env, tests/**/*.test.ts, @ alias
.env.example                # documented env vars
.gitignore                  # keep .env.example, ignore .env*
tsconfig.json               # @/* alias (from scaffold)
```

### Decisions / deviations

- **Cleared the directory to bootstrap:** ACTIONS.md / IMPLEMENTATION.md / PLAN.md were temporarily moved out, `create-next-app .` run, docs moved back. `AGENTS.md` and `CLAUDE.md` are scaffold-generated.
- **`@types/node` bumped ^20 → ^24**: vitest v5 requires `@types/node@^22 || >=24`; matches installed Node v24.
- **`drizzle-kit` installed as devDependency** (not a runtime dep) — it is a CLI used only for migrations.
- **Config design (`loadConfig`):**
  - `STT_PROVIDER` defaults to `"mock"`; `LLM_PROVIDER` defaults to **`"openai"`** (the agent loop needs a real LLM in prod and dev; updated during the AI SDK migration). Real provider values require their API key at runtime (`superRefine`), satisfying "missing required env throws at call time"; `mock` is a test-only escape hatch.
  - Optional fields (`DATABASE_URL`, `REDIS_URL`, API keys) are unset in dev so Phase 0–7 run on memory adapters without external services.
  - `loadConfig` accepts an `EnvVars` record (`Record<string, string | undefined>`) rather than `NodeJS.ProcessEnv` because Next.js augments `ProcessEnv` with a required `NODE_ENV`, which made plain test objects untypeable. `process.env` remains the default argument.
- **Composition uses `@evyweb/ioctopus` instead of a `src/di`/`src/ports` abstraction layer:** the IoC container *is* the abstraction boundary. `src/container/index.ts` is the composition root (typed `AppRegistry`, `createAppModule`, `buildContainer`); port contracts will live in `src/container/*.ts` and resolve via `container.get('TOKEN')` with full type safety. No hand-rolled `ServiceContainer` type.
- **`AppConfig` exported as `type` alias** (from `z.infer`) because `interface X extends z.infer<...> {}` trips `@typescript-eslint/no-empty-object-type`.
- **Core versions:** next 16.3.5, react 19.2.8, zod 4.6.4, vite/vitest 5.0.0, drizzle-orm 0.45.2, drizzle-kit 0.31.10. Note: Next.js 16 has breaking changes vs older training data — follow `node_modules/next/dist/docs/` when writing app code.
- **ESLint note:** scaffold ships `eslint@9.39.5` which prints a deprecation warning at install (npm) — not a project error.
- **npm audit:** 4 moderate advisories come from `drizzle-kit` → `@esbuild-kit/*` → `esbuild <=0.24.2` (dev-only dev-server advisory). `npm audit fix --force` would downgrade drizzle-kit to 0.18.x (a breaking change), so it was intentionally left; revisit when drizzle-kit publishes a patched chain.

### Next up

Phase 1 — Domain Layer (T1.1–T1.11): pure types + Zod schemas + unit tests in `src/domain/` and `tests/domain/`.

---

## Phase 1: Domain Layer — COMPLETE (T1.1–T1.11)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 8 files, 51 tests, all pass (container 3, config 7, bootstrap 1, domain 40).

### Files created/changed

```
src/domain/base-kinds.ts       # EntityBaseKindSchema, BASE_KIND_CATALOG
src/domain/entity-types.ts     # AttributeValue / AttributeKind / AttributeDef / EntityType (superRefine)
src/domain/builtins.ts         # core entity types (character, place, object) parsed at load
src/domain/story-types.ts      # StoryTypePreset + spaceOperaPreset (starship, planet, faction, …)
src/domain/entities.ts         # MediaRef, Entity, validateAttributes, validateEntity
src/domain/provenance.ts       # Confidence (4-valued), Provenance, FactKind, Claim, Fact, listActiveFacts
src/domain/events.ts           # TimelineRef, StoryEvent
src/domain/relationships.ts    # Relationship, RelationshipChange
src/domain/knowledge.ts        # KnowledgeStatus, EntityKnowledge, getKnowledge
src/domain/scenes.ts           # Scene
src/domain/plot-threads.ts     # PlotThread, OpenQuestion
src/domain/story-world.ts      # StoryWorld aggregate (+ revision), Draft, Meta
src/domain/proposals.ts        # storyChangeSchema + Proposed* schemas, Contradiction
src/domain/commits.ts          # Commit, emptyCommit, applyCommit (pure reducer), SupersedeAction
src/domain/index.ts            # barrel re-exports
tests/domain/entity-types.test.ts   # 15 tests
tests/domain/proposals.test.ts      # 6 tests
tests/domain/provenance.test.ts     # 6 tests
tests/domain/knowledge.test.ts      # 4 tests
tests/domain/commits.test.ts        # 9 tests
```

### Decisions / deviations

- **`StoryWorld.revision: number` added** (not in original §5.1 spec) — `applyCommit` enforces `commit.appliedFromRevision === world.revision` and returns `revision + 1`; needed by T2.3 concurrent-edit guard. `CommitResult` returns the new world via `applyCommit`.
- **`applyCommit` lives in the domain** (`src/domain/commits.ts`) as a pure reducer: throws on revision/storyId mismatch, duplicate entity id, unknown entity type, empty subtitle, `media` on `abstract` base entity, invalid attributes; enforces `supersededBy` on knowledge-supersede actions.
- **Builtin/story-type seeds are parsed through their Zod schemas at module load** (not typed as `AttributeDef[]` directly): zod 4.6.4 `.default()` makes `required`/`multi` fields required on the *output* type, so plain seed objects fail type-check. Solved with `SeedAttributeDef` + `normalizeDefs` + `.parse()`.
- **`FactKind` reserved but unused** for now (provenance layer) so claims keep the `kind` dimension without committing extraction semantics.
- **Time refs kept simple** (`TimelineRef` in events.ts); deeper plot-arc/time APIs deferred to later phases until UI needs them.
- **`StoryChangeProposal` base fields generalized** — `entityType` may be a concrete type id or a base kind id on `storyChange` (per §8.4), and merge/upsert rules are type-aware (base-kind batch insert vs single-entity upsert).

### Plan / config adjustments (post-"multi-user STT" design review)

- **Multi-tenant `Dictation`:** every dictation is owned by `userId` (from authenticated session at submit); `assemblyaiJobId` → **`providerJobId`** (AssemblyAI `transcript_id`); added `findDictationByProviderJobId` to the TranscriptStore port so the STT webhook (which carries only `transcript_id`) resolves the DB row → user/story. Webhook URLs no longer carry `?dictationId=&storyId=` (removed from §9.1/§9.2) and callbacks verify `WEBHOOK_SECRET` (echoed via AssemblyAI `webhook_auth_header_name`/`webhook_auth_header_value`).
- **Queue moved to AWS SQS:** `REDIS_URL`/BullMQ removed from config; added optional `AWS_REGION`, `SQS_QUEUE_URL`, `WEBHOOK_SECRET`. AssemblyAI is a single-account, rate-limited API (one key shared across all users) — a queue is still required; SQS is fully managed and the consumer bounds parallelism via `maxConcurrency`. Dev/tests keep the in-memory adapter. Adapter swap only — port contract unchanged.
- **Source of truth for all of the above:** ACTIONS.md T0.4/T2.4/T8.5/T10.1/T11.x/T12.1/T12.10 and IMPLEMENTATION.md §2/§3/§4/§6.4/§6.5/§9.1/§9.2/§13/§14/§15.

---

## Phase 2: Container Registry (IoC tokens & port contracts) — COMPLETE (T2.1–T2.7)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 9 files, 53 tests, all pass (added `tests/container-ports.test.ts`, 2 tests: all 7 port tokens resolve via ioctopus + import acceptance).

### Files created/changed

```
src/container/llm.ts               # ModelTier, LlmClient (complete/extractStructured), CompletionRequest/Result,
                                   # ExtractionRequest<T>/Result<T> — tool-calling chat types trimmed (AI SDK owns them)
src/container/stt.ts               # SpeechToText, TranscribeRequest (webhookAuth), TranscriptResult, getTranscript
src/container/story-world-store.ts # commit-based StoryWorldStore + EntityRef/EventQuery/Snapshot
src/container/transcript-store.ts  # TranscriptStore + Dictation (userId, providerJobId), findDictationByProviderJobId
src/container/job-queue.ts         # JobQueue (enqueue/onJobCompleted/onJobFailed/getStatus) + JobStatus/ExtractionJob
src/container/clock.ts             # Clock (now/elapsed)
src/container/registry.ts          # AppRegistry (7 tokens) + re-exports; moved out of index.ts
src/container/index.ts             # re-exports registry; createAppModule/buildContainer unchanged (CONFIG bound)
tests/container-ports.test.ts      # resolves all port tokens through ioctopus with typed stubs
IMPLEMENTATION.md                  # §6.1–§6.6 reconciled; SemStore removed; chat added; §7/§8 agent-loop rewrite
ACTIONS.md                         # T2/T3 renumbered; Phase 5/6/7 rewritten (tool server + agent loop); Phase 14 (pgvector) removed
```

### Decisions / deviations

- **Port contracts follow ACTIONS.md T2.x** (the task spec); IMPLEMENTATION.md §6 was reconciled to match the code, not the other way around. Notably: `StoryWorldStore` is **commit-based** (`commit(commit: Commit): Promise<CommitResult>`, `getWorld`, `byRevision`, `queryEvents`) — the old §6.3 granular CRUD (getStory/createStory/insertFact/…) is gone; `upsertEntityType`/`listEntities` registry ops are retained. Story CRUD was intentionally **not** added (no task depends on it yet; will be added when T12/T8 needs it).
- **LLM port named per ACTIONS:** `extractStructured<T>` (not §6.2's `extractProposal`), `ModelTier` (not `LLMTier`), with `CompletionRequest`/`ExtractionRequest<T>`/`ExtractionResult<T>`; `schema` is a `ZodType<T>` (zod v4 still exports `ZodType`), so the OpenAI adapter can serialize it to JSON Schema.
- **STT port extended with** `getTranscript` (> T10.1 + §9.2 use it) and `webhookAuth` on `TranscribeRequest` (echoes `WEBHOOK_SECRET`); the webhook correlation contract (`%providerJobId` ↔ `findDictationByProviderJobId`) is untouched.
- **Design change (user decision):** extraction moved from single-shot `extractStructured` to an **agent loop over a story tool server** (T5.x), driven by the **Vercel AI SDK** (`generateText` + `tools` + `stopWhen`) instead of a hand-rolled `LlmClient.chat` loop. `SemanticStore` / pgvector / embeddings were **removed entirely** — no `SEMANTIC_STORE` token, no semantic search anywhere. Guided fetch is registry-based: the system prompt carries the entity-type registry; `get_entities` returns bounded subsets (default 50 / max 200) enforced server-side; mutations stage in a session and persist only via `applyCommit` → `StoryWorldStore.commit` with server-stamped provenance.
- **JobQueue** is `JobQueue` (non-generic, §6.5/§9.3 shape) but gained `getStatus` + `JobStatus`/`ExtractionJob` from ACTIONS T2.6; handlers are `(data: unknown)` — workers cast to the job type.
- **`AppRegistry` moved to `src/container/registry.ts`** with 7 tokens (CONFIG/STT/LLM/STORY_WORLD_STORE/TRANSCRIPT_STORE/JOB_QUEUE/CLOCK — no SEMANTIC_STORE); `@/container` re-exports it so `import { AppRegistry, LlmClient, SpeechToText } from '@/container'` works.

## Phase 3: Mock Adapters — COMPLETE (T3.1–T3.6)

> **Post-review relocation:** after review the mock adapters were moved out of `src/adapters/memory/` into `tests/mocks/` — mocks are test doubles and must never ship in `src/` (real adapters only in `src/adapters/`). Everything below reflects the final location.

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 warnings/errors.
- `npm test` — 12 files, 77 tests, all pass.

### Files created/changed

```
tests/mocks/llm.ts               # MockLlm: fixtures (extractStructured) + canned completions (complete); chat removed
tests/mocks/sdk-model.ts         # scriptedModel(): AI SDK LanguageModel (MockLanguageModelV4) walking a tool-call script
tests/mocks/stt.ts               # MockStt: immediate mock-N job id, canned transcript, prefix-validated job lookups
tests/mocks/story-world-store.ts # MockStoryWorldStore: Map-backed, commits via applyCommit, byRevision snapshots,
                                 # upsertEntityType/getEntityTypes/findEntityTypeByName, findEntityByName (name+aliases,
                                 # case-insensitive), listEntities(typeId?), attachMedia/getMedia, insertKnowledge/getKnowledge
tests/mocks/transcript-store.ts  # MockTranscriptStore: Map<Dictation> + findDictationByProviderJobId, updateDictation, listDictations
tests/mocks/job-queue.ts         # MockJobQueue: onJobCompleted/onJobFailed/wait/emit + getStatus
tests/mocks/clock.ts             # MockClock (deterministic)
tests/mocks/index.ts             # mock barrel (T3.6)
tests/mocks/memory-container.ts  # buildMemoryContainer (T4.2) — wires mocks into an ioctopus container
src/adapters/index.ts            # empty barrel again (only real adapters here; SystemClock at src/adapters/system-clock.ts from Phase 4)
tests/adapters/memory.test.ts    # 11 tests (LLM fixtures/script, STT round-trip, commit store T1.11-style, supersede,
                                 # transcript round-trip, job-queue completed/failed)
```

### Decisions / deviations

- **Mocks live in `tests/mocks/` (test-land), never `src/`** — `src/adapters/` is reserved for real adapters. This was a deliberate post-review relocation; ACTIONS.md T3.1–T3.6 file paths updated accordingly.
- **`MockStoryWorldStore` reuses the domain reducer:** `commit` runs `applyCommit` (the same validation gate the Postgres adapter enforces) and records an immutable snapshot per revision; `byRevision` reads snapshots. Auxiliary `attachMedia`/`insertKnowledge` live in separate maps merged into reads (`getWorld`/`getEntity`/`findEntityByName`/`listEntities`) so snapshots never drift.
- **`findEntityByName` is case-insensitive and matches `aliases`** across all types per T2.3/T3.3.
- **Mock LLM drives only `complete`/`extractStructured`.** The extraction agent loop was migrated off `LlmClient.chat` onto the Vercel AI SDK, so scripting moved to `tests/mocks/sdk-model.ts`: `scriptedModel(steps)` wraps the SDK's `MockLanguageModelV4` and walks `{ content?, toolCalls? }` steps exactly like the old chat script. `extractStructured` parses a matching fixture keyed by message substring, else an empty `StoryChangeProposal`. No real provider and no parser retry needed for mocks.
- **`MockStt` validates `jobId` prefix** (`mock-` by default) in `getJobStatus`/`getTranscript`; unknown job ids return `failed` / throw. `submitTranscription` returns `mock-1`, `mock-2`, … (T3.2).
- **`MockJobQueue` executes handlers synchronously in-process** (deterministic pipeline tests); if no handler is registered for a job name the job stays `queued`. Handler failure routes to `onJobFailed` and marks the job `failed`.
- **Contract-test suite (T4.5) deferred to Phase 4** — T3.x verification here uses the direct mock tests plus the T1.11-style commit acceptance; T4.5 remains the formal reusable adapter contract.

### Next up

Phase 4 — Composition Root & Service Container (T4.1–T4.5): extend `AppRegistry` (7 tokens + CONFIG via Phase 2), `buildMemoryContainer` (in `tests/mocks/memory-container.ts`), stub `buildContainer`, container-isolation guarantee, and the reusable adapters contract test suite.

---

## Phase 4: Composition Root & Service Container — COMPLETE (T4.1–T4.5)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 12 files, 77 tests, all pass (added `tests/container-memory.test.ts`, 4 tests; `tests/adapters/contract.story-world-store.test.ts`, 9 contract tests).

### Files created/changed

```
tests/mocks/memory-container.ts                  # buildMemoryContainer: wires mock adapters via ioctopus (tests/dev only)
src/container/index.ts                           # buildContainer (NotImplementedError for every unbuilt adapter) + NotImplementedError
src/adapters/system-clock.ts                     # SystemClock — real Clock adapter (only real adapters live in src/adapters/)
src/adapters/index.ts                            # exports SystemClock
tests/container-memory.test.ts                   # typed resolution, container isolation, NotImplementedError branches
tests/adapters/support/story-world-store-contract.ts # runStoryWorldStoreContract(store: () => StoryWorldStore) — reusable for Postgres (T14.2)
tests/adapters/contract.story-world-store.test.ts    # runs the contract against MockStoryWorldStore
tests/adapters/memory.test.ts, tests/container.test.ts # import paths updated (mocks now live in tests/mocks)
```

### Decisions / deviations

- **Mocks are not src code.** After review, `src/adapters/memory/` was removed entirely; mock adapters live in `tests/mocks/` and the mock container builder in `tests/mocks/memory-container.ts`. `src/adapters/` contains only a real `SystemClock` until real adapters ship (T8.x, T9.x, T10.x, T11.x).
- **T4.1 was already satisfied by Phase 2** — `AppRegistry` maps all 7 port tokens + `CONFIG`; this phase proved typed resolution through the fully-wired mock container (no casts): `container.get("STT"): SpeechToText`, etc.
- **`SystemClock` stays in src (`src/adapters/system-clock.ts`)** as a real adapter for the `CLOCK` token; `MockClock` (deterministic) is a mock in `tests/mocks/clock.ts`.
- **Mocks bind via `toClass`** (ioctopus default `singleton` scope → one instance per container; separate `buildMemoryContainer()` calls get fully independent instances, so no state leaks between requests/tests — T4.4 acceptance).
- **`buildContainer(config)` has no fallback to mocks anymore** — it binds CONFIG+CLOCK and throws `NotImplementedError` at binding time for every adapter that isn't implemented (real providers → phase-referencing message; mock providers → note that mocks exist only under `tests/mocks`). T8.5/T9.3/T11.x will fill in real branches. Dev/tests get a working container from `buildMemoryContainer()`.
- **The per-request `React.cache` "scoped container" (earlier draft) was dropped:** with mocks out of src there is nothing real to memoize per request; the isolation guarantee is what T4.4 actually requires, and it's asserted directly. A scoped wrapper returns when src has real adapters (T8.5).
- **Contract suite lives in a support module** (`tests/adapters/support/story-world-store-contract.ts` exporting `runStoryWorldStoreContract`) so T14.2 can run the identical suite against Postgres; the `.test.ts` runner applies it to the mock store. Covers: null world/entity/`byRevision` for unknown stories; register-type + add-entities commit with name+alias (case-insensitive) lookup; `appliedFromRevision` guard + commit atomicity (failed commit leaves world untouched); `queryEvents` by setting/participant/date-range; `byRevision` immutability (snapshot ≠ live world, untouched by later commits); supersede flow + unknown-target rejection; registry upsert (same case-insensitive identity on re-upsert) + `listEntities` filter; media/knowledge merged into `getWorld` reads; snapshots unaffected by later auxiliary writes.
- **Data-driven by the contract:** `MockStoryWorldStore.upsertEntityType` matched by exact name while `findEntityTypeByName` was case-insensitive — re-upserting `"Planet"` after `"planet"` created a duplicate. Now case-insensitive (matching the found-by name semantics Postgres will need).

### Next up

Phase 5 — Services Layer: Story Tool Server & Extraction Agent (T5.1–T5.5): tool catalog (reads + staged writes + `finish`), executor (`validateEntity`/duplicate/contradiction guards, bounded `get_entities`, default 50 / max 200), `CommitBuilder.buildFromStaged` with server-stamped provenance, `TranscriptProcessor.process(job)` agent loop (≤ 40 tool calls / ≤ 200 fetches) driven by the **Vercel AI SDK** (`stopWhen` budgets; SDK-scripted tests).

---

## Phase 5: Services Layer — Story Tool Server & Extraction Agent — COMPLETE (T5.1–T5.5)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 15 files, 105 tests, all pass (added `tests/services/llm-agent/tools/executor.test.ts`, 14 tests; `tests/services/llm-agent/transcript-processor.test.ts`, 6 tests (AI SDK–scripted); `tests/adapters/llm-provider.test.ts`, 3 tests; `tests/container.test.ts` +1 DI wiring; `tests/domain/commits.test.ts` +2).

### Files created/changed

```
src/services/llm-agent/tools/definitions.ts  # STORY_TOOL_CATALOG (14 tools) with zod input schemas (zod 4 → JSON Schema
                                                 # via the AI SDK's zodSchema), budget constants, ToolOutput (ok/err), ToolCall type
src/services/llm-agent/tools/sdk.ts          # buildStoryTools({store, session}) → AI SDK ToolSet (tool() + zodSchema() +
                                                 # execute → StoryToolExecutor)
src/services/llm-agent/tools/session.ts       # ExtractionSession + staged state, synthetic staged-* ids, Session (static helpers)
src/services/llm-agent/tools/executor.ts      # StoryToolExecutor.execute(store, session, call): staged-write dispatch,
                                                 # validation/dup/contradiction guards, bounded get_entities (default 50 / max 200),
                                                 # hard budget stops
src/services/llm-agent/tools/build-commit.ts  # CommitBuilder.build(store, session, {dictationId, textChunk}) — server-stamped
                                                 # provenance, name→id resolution, contradiction→supersede mapping,
                                                 # CommitBuilder.buildFromStaged
src/services/llm-agent/tools/index.ts         # barrel
src/services/llm-agent/transcript-processor.ts # TranscriptProcessor: constructor-DI (model + store), chunkText (16k chars)
                                                 # + private runChunk (generateText{ model, system, prompt, tools,
                                                 # stopWhen: [stepCountIs(40), hasToolCall('finish'), fetch/tool budgets] })
                                                 # + buildSystemPrompt; bound as TRANSCRIPT_PROCESSOR in the container
src/services/llm-agent/index.ts               # barrel
src/services/index.ts                         # now exports ./llm-agent + ./llm-agent/tools (was placeholder)
src/adapters/llm-provider.ts              # createLanguageModel(config): real AI SDK LanguageModel via @ai-sdk/openai|
                                             # @ai-sdk/anthropic (LLM_PROVIDER + LLM_STANDARD_MODEL); mock → NotImplementedError
src/domain/commits.ts                        # Commit.resolvedOpenQuestionIds + CommitResult.openQuestionsResolved (applyCommit)
tests/services/llm-agent/tools/executor.test.ts    # 14 tests
tests/services/llm-agent/transcript-processor.test.ts # 6 tests (scripted AI SDK model via tests/mocks/sdk-model.ts)
tests/adapters/llm-provider.test.ts            # 3 tests (openai/anthropic model identity, mock refused)
tests/domain/commits.test.ts                      # +2 tests (resolution via applyCommit)
tests/adapters/memory.test.ts, tests/adapters/support/story-world-store-contract.ts, tests/container-ports.test.ts # Commit/CommitResult literals
```

### Decisions / deviations

- **Open-question resolution got a home in the append-only reducer:** `Commit` gained `resolvedOpenQuestionIds: string[]` and `CommitResult.openQuestionsResolved`; `applyCommit` resolves (and rejects unknown/already-resolved) staged `stage_resolve_open_question` id sets on commit. This deviates from the original T5.3 spec (no question-resolution field) and is documented in ACTIONS.md T5.3.
- **`TranscriptProcessor.process(job)` returns `ProcessTranscriptResult`** (per-chunk `ChunkTrace[]` + aggregated `commitResults`), not a bare `CommitResult` as the original T5.4 spec said. ACTIONS.md T5.4 updated to match.
- **Staged entities get deterministic synthetic ids** (`staged-<n>-<slug>`) so the model can `get_entity`/`stage_update_entity` them before real UUIDs are assigned at commit time; the commit builder assigns UUIDs and resolves names → ids.
- **`supersedeFactIds` keeps agent authority:** duplicate/conflicting facts auto-stage the old fact for supersede and surface a `recommendedAction: "supersede"` contradiction, but supersession only triggers when the agent explicitly calls `supersede_fact` (mirrors the §8.4 user-in-the-loop design).
- **Services are static namespace classes** (`StoryToolExecutor`, `CommitBuilder`, `Session`, `ToolOutput`) — no instances, no container bindings; the store/LLM are threaded through each call. **Exception: `TranscriptProcessor` is constructor-DI** (`ExtractionDeps { model, store }`), bound as `TRANSCRIPT_PROCESSOR` in the composition root `buildContainer` and resolved via `container.get('TRANSCRIPT_PROCESSOR')` — it owns the container-bound agent loop while the tool layer stays provider-agnostic. The reader world is fetched per tool call (`store.getWorld`) rather than cached: the world cannot change mid-chunk because commits only happen at chunk boundaries, so every call in a chunk still sees one coherent revision.
- **The agent loop is driven by the Vercel AI SDK (ai@7), not `LlmClient.chat`:** `TranscriptProcessor`'s `runChunk` builds the tool set from the zod catalog (`buildStoryTools`) and calls `generateText({ model, system, prompt, tools, temperature: 0, stopWhen })`. The SDK validates tool inputs against the zod schemas and assembles multi-step calls/results for free; the hand-rolled message pump and `ToolCall`/`ChatMessage`/`ChatRequest`/`ChatResult` port types were deleted from `src/container/llm.ts` (kept: `complete`, `extractStructured`). The processor is **constructor-injected** with `{ model, store }` (bound as `TRANSCRIPT_PROCESSOR`); `process(job)` takes only the job.
- **Budget enforcement maps to `stopWhen` conditions** (T5.2/T5.4 parity): `stepCountIs(MAX_TOOL_CALLS)`, `hasToolCall('finish')`, plus `session.counters.toolCalls`/`fetchedEntities` conditions; the executor's per-call guards still reject calls past the limits. `stoppedReason` is derived from the last step + counters (`finished` / `tool-call-limit` / `fetch-limit` / `no-tool-calls`) exactly as before.
- **Tool schemas are zod, not hand-written JSON Schema:** `STORY_TOOL_CATALOG` entries carry `inputSchema` (zod 4 strict objects; `describe()` → parameter descriptions) which the SDK converts via `zodSchema()`. `get_entities` args are still validated in the executor too (defensive `str/num/arr` parsing kept).
- **A real LLM provider is the app default (production and development):** `LLM_PROVIDER` defaults to `openai` and requires `LLM_API_KEY` (now also supports `anthropic`; `mock` is test-only). `createLanguageModel(config)` (src/adapters/llm-provider.ts) returns an AI SDK `LanguageModel` via `@ai-sdk/openai` / `@ai-sdk/anthropic` using `LLM_STANDARD_MODEL`; tests inject `scriptedModel` instead. `buildMemoryContainer` forces `LLM_PROVIDER=mock` since it only ever wires test doubles.
- **Transcript arrives on the payload** (`ExtractionJob.transcript`) — no extra `TranscriptStore` read hop; `TextAssetStore` said "defer until needed" so the agent only needs an AI SDK `LanguageModel` + `StoryWorldStore`.
- **`applyCommit` remains the single validation gate** the future Postgres adapter enforces (T14.2); `CommitBuilder` routes every staged session through it.

### Next up

Phase 6 — STT Service (AssemblyAI adapter + `onTranscribed` webhook flow, STT→extract orchestration).

---

## Phase 8: Postgres / Drizzle — Schema + Migrations + Adapters — COMPLETE (T8.1–T8.5)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 17 files, 123 tests, all pass (incl. `tests/adapters/postgres.test.ts`, 12 tests against live `novelos_test`).
- `DATABASE_URL=postgres://localhost:5432/novelos_test npm run db:migrate` applies both migrations idempotently; `psql` confirms 14 tables + 2 rows in `drizzle.__drizzle_migrations`.

### Files created/changed

```
drizzle/schema.ts              # 14 tables (stories, entity_types, entities, attributes, facts, relationships,
                               #    knowledge, plot_threads, open_questions, secrets, scenes, events, media,
                               #    activity) + 5 pgEnums (base_kind, attribute_kind, fact_kind, confidence,
                               #    knowledge_status); every row carries revision for append-only byRevision reads
drizzle.config.ts              # drizzle-kit config (schema + drizzle/migrations + novels_test)
drizzle/migrate.mts            # db:migrate runner — .mts (tsx CJS rejects top-level await in .ts)
drizzle/migrations/0000_initial.sql          # drizzle-kit generate --name=initial
drizzle/migrations/0001_scenes-chapter-number.sql # scenes.chapter_number added post-hoc
package.json                   # db:generate / db:migrate / db:studio scripts; tsx ^4.23.13 devDependency
src/adapters/postgres/story-world-store.ts  # PostgresStoryWorldStore — revision-capped byRevision reads,
                                            #   applyCommit single-transaction gate + optimistic revision bump,
                                            #   computeSupersededMap mirrors domain supersede
src/adapters/postgres/transcript-store.ts   # PostgresTranscriptStore — upserts story shell (Untitled story/system)
                                            #   before inserting dictations (stories FK)
src/adapters/postgres/index.ts              # barrel
src/container/index.ts                      # buildContainer binds Postgres adapters via drizzle(postgres(url), { schema });
                                            #   DATABASE_URL required (throws) — real adapters are real-only
tests/adapters/postgres.test.ts             # truncates 14 tables per factory; runs the StoryWorldStore contract
                                            #   (9 tests) + TranscriptStore round-trip + 2 T8.5 container tests
tests/adapters/support/story-world-store-contract.ts # factory signature made async (await factory()) — reused by Postgres
tests/container-memory.test.ts              # buildContainer with fake DATABASE_URL (no DB connection needed)
```

### Decisions / deviations

- **Append-only + revision columns replace a separate event-store log** — every table carries `revision`; `byRevision(N)` filters `revision <= N`, so snapshots reconstruct from the immutable table state without an event log.
- **Provenance dictation ids are not FK-constrained** — the STT webhook can arrive before `saveDictation`, and contract tests use arbitrary dictation ids; correctness is enforced at the service layer, not the schema.
- **`drizzle(client, { schema: databaseSchema })` is mandatory** for typed `PostgresJsDatabase<typeof schema>` — plain `drizzle(client)` yields `Record<string, never>` and fails typecheck.
- **buildContainer requires `DATABASE_URL`** at build time; unshipped adapters (`STT`, `JOB_QUEUE`, and any non-`openai` `LLM` provider) stay **lazy** `toFactory` bindings that throw a descriptive `NotImplementedError` at resolve time, not binding time.
- **`drizzle/migrate.mts`** uses the `.mts` extension because `tsx` (CJS) rejects top-level `await` in a `.ts` file; `.mts` works.

### Next up

Phase 9 — OpenAI LLM adapter (see below), then Phase 10 AssemblyAI STT (T10.1–T10.2), Phase 11 SQS (T11.1).

---

## Phase 9: OpenAI LLM Adapter — COMPLETE (T9.1–T9.3)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 17 files, 123 tests, all pass (added `tests/adapters/openai.test.ts`, 5 tests; `tests/container-memory.test.ts` +1 T9.3 wiring test).

### Files created/changed

```
src/adapters/openai/llm-client.ts   # OpenAiLlm — complete → generateText; extractStructured → zodSchema +
                                    #   generateObject JSON mode + once-parse-failure re-prompt; tier routing
                                    #   cheap/standard/best → gpt-5-nano/gpt-5-mini/gpt-5-pro (per-tier override via
                                    #   LLM_*_MODEL config); AI SDK usage (number | undefined) coalesced to 0;
                                    #   modelForTier test seam injects scripted models
src/adapters/openai/index.ts        # barrel: OpenAiLlm + openaiLlm factory
src/adapters/index.ts               # re-exports src/adapters/openai
src/container/index.ts              # T9.3: LLM_PROVIDER=openai → openaiLlm({ apiKey, models }); others → lazy
                                    #   NotImplementedError pointing at LLM_PROVIDER=openai
tests/adapters/openai.test.ts       # complete text+usage, extractStructured parse+validate, exactly-one retry,
                                    #   retry re-throws when repair fails, full domain schema (storyChangeSchema)
                                    #   with defaults, tier selection via modelForTier
tests/container-memory.test.ts      # LLM_PROVIDER=openai (fake key, no live call) resolves complete/extractStructured
```

### Decisions / deviations

- **`createLanguageModel` (agent-loop model) and `OpenAiLlm` (LlmClient) both ship in T9.1** — the tool-calling agent loop runs on the AI SDK `LanguageModel` (`generateText` + tools), while the port-facing `complete`/`extractStructured` adapter is the OpenAI `LlmClient`. The `LLM` container token binds the latter.
- **Per-tier model names come from config** (`LLM_CHEAP/STANDARD/BEST_MODEL`, defaults `gpt-5-nano`/`gpt-5-mini`/`gpt-5-pro`) instead of hard-coded names, so DNS-style model swaps don't require a code change.
- **Retries only on parse/schema failure, exactly once** — the model re-reads its previous output with a strictness hint appended to the prompt and re-renders JSON; a second failure rethrows.
- **`modelForTier` is the test seam** — adapter tests drive `MockLanguageModelV4` scripted models (tests/mocks/sdk-model.ts) without a live OpenAI connection; `openaiLlm` only constructs `createOpenAI` when no seam is injected.

### Next up

Phase 10 — AssemblyAI STT adapter (T10.1–T10.2): `submitTranscription` uploads audio + webhook auth echo, `getTranscript` by `transcript_id`; then Phase 11 SQS job queue (T11.1).

---

## Phase 10: AssemblyAI STT Adapter — COMPLETE (T10.1–T10.2)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 19 files, 139 tests, all pass (added `tests/adapters/assemblyai.test.ts`, 6 tests; `tests/container-memory.test.ts` +2: STT + JOB_QUEUE wiring).

### Files created/changed

```
src/adapters/assemblyai/stt.ts   # AssemblyAiStt over the v2 REST API via native fetch (no SDK dep):
                                 #   POST /v2/upload (audio, Authorization: STT_API_KEY) → audio_url,
                                 #   POST /v2/transcript (audio_url + webhook_url + webhook_auth_name/value echo),
                                 #   GET /v2/transcript/{id} for getJobStatus (queued/processing/completed/error→failed)
                                 #   + getTranscript (text, word segments, audio_duration→seconds); AssemblyAiError
                                 #   carries provider HTTP status; baseUrl + fetch injection seams for offline tests
src/adapters/assemblyai/index.ts # barrel: assemblyaiStt + AssemblyAiStt + AssemblyAiError
src/adapters/index.ts            # re-exports ./assemblyai
src/container/index.ts           # STT_PROVIDER=assemblyai (+STT_API_KEY) → real AssemblyAiStt; else lazy
                                 #   NotImplementedError pointing at STT_PROVIDER=assemblyai
tests/adapters/assemblyai.test.ts # fake AssemblyAI API over the fetch seam (6 tests)
tests/container-memory.test.ts    # T10 wiring test
```

### Decisions / deviations

- **Native fetch instead of the `assemblyai` npm SDK** — same REST endpoints, zero new dependencies, and `baseUrl`/`fetch` seams give deterministic offline tests (the fake API records every request for header/payload assertions) and a path to a self-hosted relay.
- **Webhook auth echo ships at submit time** (`webhook_auth_header_name`/`webhook_auth_header_value` from `TranscribeRequest.webhookAuth`, echoing `WEBHOOK_SECRET`) — the callback (T12.x webhook route) trusts only that echoed header.
- **`getTranscript` word-level segments map to `TranscriptSegment`** (start/end ms, confidence) and `audio_duration` (ms) → `durationSeconds` — both optionally present.

### Next up

Phase 11 — AWS SQS job queue (T11.1–T11.3): consumer with `maxConcurrency` bound + DLQ + dev in-memory fallback, worker entry, barrels.

---

## Phase 11: AWS SQS Job Queue Adapter — COMPLETE (T11.1–T11.3)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 19 files, 139 tests, all pass (added `tests/adapters/sqs.test.ts`, 8 tests; `tests/container-memory.test.ts` +1 T11 wiring).

### Files created/changed

```
src/adapters/sqs/job-queue.ts   # SqsJobQueue (T11.1): enqueue → SendMessage({ jobName, data } body + jobName
                                #   attribute); consumer start() → long-poll ReceiveMessage → dispatch under a
                                #   maxConcurrency semaphore; delete processed; failed → DLQ (dlqUrl) or delete;
                                #   getStatus keyed by message ids; resilience "strict"|"local-fallback" (dev
                                #   degrades to the in-process queue with a logged warning + keeps registered
                                #   handlers, no busy-spin: short-poll yields 25ms); stop() drains handers
src/adapters/sqs/index.ts       # barrel: sqsQueue factory + SqsJobQueue
src/adapters/index.ts           # re-exports ./sqs
workers/index.ts                # T11.2: boots buildContainer(), registers extraction → TRANSCRIPT_PROCESSOR,
                                #   queue.start() for SqsJobQueue, graceful SIGTERM/SIGINT (stop + exit)
package.json                    # "worker": "tsx workers/index.ts"
src/container/index.ts          # SQS_QUEUE_URL set → new SqsJobQueue(client: SQSClient({region}), maxConcurrency 10,
                                #   resilience local-fallback, warn logger); else lazy NotImplementedError → SQS
tests/adapters/sqs.test.ts      # fake SQS client over the injected seam (8 tests)
tests/container-memory.test.ts  # T11 wiring test
```

### Decisions / deviations

- **SQS client is injectable** — tests pass a fake client whose `send` routes on `command.constructor.name`, so the adapter is verified without LocalStack; a real LocalStack e2e is an ops-level verification (documented in ACTIONS T11.1).
- **Local-fallback lives in src, not tests/mocks** — the resilience path is a real branch of the production adapter (`resilience: "local-fallback"`), used by `buildContainer`, so dev survives an unreachable queue without importing mocks into src.
- **`start()`/`stop()` are concrete `SqsJobQueue` methods beyond the `JobQueue` port** — API/webhook processes enqueue only; the polling consumer is started explicitly by `workers/index.ts` (and drained on shutdown).
- **Job payload is `{ jobName, data }` with jobName duplicated as a message attribute** — routing survives bodies whose JSON parse fails.

### Next up

Phase 12 — API routes (T12.1–T12.10): `POST /api/dictations` (multipart upload → `saveDictation` + `submitTranscription` + `providerJobId`), AssemblyAI webhook route (verify echoed `WEBHOOK_SECRET`, resolve `transcript_id` → dictation, queue extraction), story/entity query+edit routes, dictation status endpoint.

---

## Phase 12: API Routes — COMPLETE (T12.1–T12.10)

Ten API routes behind three shared helpers. The app's runtime container is resolved through `resolveContainer()`; uniform `{ error }` JSON errors; the mock auth seam is the `x-user-id` header (`userIdFrom`). Dictation upload persists `storyId` + `userId` on the DB row and keys the webhook correlation solely by `providerJobId` (AssemblyAI `transcript_id`), never by URL/body identity — an unknown `transcript_id` → 404, missing/wrong `WEBHOOK_SECRET` → 401.

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 197 tests across 24 files, all pass. New: `tests/routes/dictations.test.ts`, `tests/routes/stories.test.ts`, `tests/routes/reasoning.test.ts`, `tests/routes/fixtures.ts`.

### Files created/changed

```
src/server/http.ts               # jsonError(status, message) → { error }; userIdFrom(request) → x-user-id header
src/server/app-container.ts      # resolveContainer(): lazy singleton of buildContainer()
src/server/media-storage.ts      # MediaStorage port + defaultMediaStorage (node_modules/.media, uuid names)
src/app/api/dictations/route.ts  # T12.1 multipart upload → saveDictation + submitTranscription + clean webhook URL
src/app/api/dictations/[id]/route.ts      # T12.2 status + CommitResult summary
src/app/api/stories/[id]/route.ts         # T12.3 full StoryWorld
src/app/api/stories/[id]/entities/[entityId]/route.ts  # T12.4 PATCH (attributes/aliases/media, validate + commit)
src/app/api/stories/[id]/ask/route.ts              # T12.5 askStory → { answer }
src/app/api/stories/[id]/analyze/route.ts          # T12.6 checkContinuity → { reports }
src/app/api/stories/[id]/knowledge/route.ts        # T12.7 doesEntityKnow → { status, context }
src/app/api/stories/[id]/entity-types/route.ts     # T12.8 user-created types (upsertEntityType, origin "user")
src/app/api/stories/[id]/entities/[entityId]/media/route.ts  # T12.9 portrait/gallery upload, abstract → 400
src/app/api/hooks/stt-callback/route.ts            # T12.10 webhook: secret check → findDictationByProviderJobId
                                                   #   → getTranscript → update status → enqueue extraction
src/container/transcript-store.ts # summary: string | null on Dictation (writer-owned aggregate preview)
src/container/story-world-store.ts# removeMedia(entityId, mediaId) for T12.4/T12.9 media sync
src/adapters/postgres/transcript-store.ts  # summary column write + story-shell insert on dictation save
src/adapters/postgres/story-world-store.ts# removeMedia SQL
tests/routes/fixtures.ts         # seeded story + container per test file
tests/routes/{dictations,stories,reasoning}.test.ts
```

### Decisions / deviations

- **Segment params are named after the folder, not the concept** — Next 16's generated route types require `[id]` → `params.id` even under `/stories/[id]`; the entity routes destructure `{ id: storyId, entityId }`. Using `storyId` as the key broke `next build` type validation.
- **Webhook identity is provider-job-id only** — the callback never trusts query params or body for user/story; `findDictationByProviderJobId(transcript_id)` resolves ownership from the DB row.
- **Media storage is a seam** — routes take an injectable `MediaStorage`; the default writes to `node_modules/.media`, and tests stub it to avoid files.
- **Summary lives on the dictation row** — workers write the aggregated `CommitResult` summary when extraction finishes so the status endpoint can render "what changed" without re-reading the whole world.

## Phase 13: UI — MVP Screens — COMPLETE (T13.1–T13.8)

A `(studio)` route group with a persistent left rail (Manuscript / Talk, Story, Ask, Continuity, plus dynamic entity sections derived from each story's registry) and the eight MVP screens. The story id is a per-browser value persisted in localStorage via `useSyncExternalStore` (so it survives reloads and stays SSR-hydration-safe); every API call goes through `src/ui/api-client.ts`, which adds the `x-user-id` mock-auth header.

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors (react-hooks + react-compiler rules clean).
- `npm test` — 197 tests, all pass.
- `npm run build` — production build succeeds; static `/`, `/talk`, `/story`, `/ask`, `/debug`; dynamic `/character/[id]`, `/scene/[id]`, `/api/*` routes.

### Files created/changed

```
src/app/(studio)/layout.tsx          # StoryProvider + Sidebar + main content column
src/ui/sidebar.tsx                   # T13.1 left rail, mobile hamburger, registry-derived sections
src/ui/story-context.tsx             # useStoryId: localStorage-persisted story via useSyncExternalStore
src/ui/api-client.ts                 # studioHeaders (x-user-id) + fetchJson; STUDIO_USER const
src/ui/mic-capture.tsx               # T13.2 MediaRecorder capture + file-picker fallback, stop() kills the track
src/ui/result-card.tsx               # T13.3 status pill + transcript + CommitResult summary; error/retry states
src/ui/talk-screen.tsx               # T13.2/3 upload + 3s status polling + reset
src/ui/story-screen.tsx              # T13.4 world fetch + entity list/detail split, handles 404 (no story yet)
src/ui/entity-list.tsx               # type-filter pills + per-type entity links
src/ui/entity-detail.tsx             # inline-edit attributes → PATCH, media rows via next/image
src/ui/character-screen.tsx          # T13.5 overview/edit tabs, baseKind guard
src/ui/character-sheet.tsx           # portrait, profile attrs, relationships, facts, scene count
src/ui/scene-card.tsx                # T13.6 chapter/when/setting/participants/summary
src/ui/scene-detail-screen.tsx       # scene detail + linked entities + events
src/ui/scene-screen.tsx              # scene list (timeline order), links → /scene/[id]
src/ui/ask-chat.tsx                  # T13.7 ask history + POST /api/stories/[id]/ask
src/ui/debug-reports.tsx             # T13.8 contradiction scan + scenes timeline
src/app/(studio)/talk/page.tsx       # Talk
src/app/(studio)/story/page.tsx      # Story (Suspense for useSearchParams)
src/app/(studio)/ask/page.tsx        # Ask
src/app/(studio)/debug/page.tsx      # Continuity
src/app/(studio)/character/[id]/page.tsx  # async page, Promise params (Next 16)
src/app/(studio)/scene/[id]/page.tsx      # async page, Promise params (Next 16)
src/app/page.tsx                     # redirect("/talk")
```

### Decisions / deviations

- **Story id is client-side for the MVP** — with no auth/list-stories API yet, the studio keys off a localStorage story id (auto-generated on first visit). Dictation upload creates the story shell, so the first take bootstraps an empty bible. A real "projects" UI replaces this later.
- **React Compiler lint enforced** — client state that used to be set synchronously in effects (localStorage hydration, report "loading") was rewritten with `useSyncExternalStore` or derived render state to satisfy `react-hooks/set-state-in-effect`.
- **`next/image` with `unoptimized`** — media URLs are arbitrary user-supplied outputs, so the optimizer is bypassed rather than maintaining `remotePatterns`; sizing is fixed via width/height.

### Next up

Phase 14 — Tests & Verification (T14.1–T14.5): end-to-end integration test over the container, Postgres adapter contract suites, cost-guard test, contradiction edge cases, and lint/typecheck gate.

---

## Phase 14: Tests & Verification — COMPLETE (T14.1–T14.5)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — 212 tests across 27 files, all pass.

### Files created/changed

```
tests/services/llm-agent/tools/supersede.test.ts   # T14.1 contradiction/supersede edge cases (8 tests)
tests/integration/full-pipeline.test.ts             # T14.2 full dictation pipeline + write-tab bypass + empty no-op
tests/services/context/cost-guard.test.ts           # T14.3 TOKEN_CAP (4000) held for maximally dense worlds
tests/adapters/support/story-world-store-contract.ts # T14.4 reusable Postgres adapter contract suite
```

### Decisions / deviations

- **Cost guard:** `buildContextFromWorld` enforces caps internally (`MAX_MENTION_MATCHES`, `MAX_RELATIONSHIPS`, etc.) that guarantee `tokenEstimate ≤ 4000`; the test builds a 100-entity / 200-fact / 100-relationship world and asserts the estimate stays within the cap.
- **Full pipeline test:** uses `transcriptStore.saveDictation()` return value as the dictation ID (not a pre-generated UUID) to ensure the stored row ID is used.
- **Supersede tests:** cover duplicate guard from world, in-session idempotency, contradiction auto-detection, no duplicate contradiction records, explicit `supersede_fact`, confidence strata preserved, commit supersedes old fact, and cross-chapter anachronism.

---

## Phase 15: Polish & Deployment — COMPLETE (T15.1–T15.4)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all pass.
- `docker compose up --build` — db + migrate + app all healthy.

### Files created/changed

```
src/ui/loading.tsx                  # T15.1 Spinner, PageSpinner, InlineError, EmptyState
src/ui/toast.tsx                    # T15.1 ToastProvider, useToast, three kinds, auto-dismiss 4s
src/ui/error-boundary.tsx           # T15.1 React error boundary (class component)
src/app/layout.tsx                  # T15.1 title "Novel OS", wrapped body in ToastProvider
src/app/story/[storyId]/layout.tsx  # T15.1 ErrorBoundary wrapper, refined padding
src/ui/dashboard.tsx                # T15.1 useToast errors, PageSpinner, EmptyState, Spinner on button
src/ui/media-upload.tsx             # T15.1 useToast errors, Spinner while uploading
src/ui/story-screen.tsx             # T15.1 PageSpinner + InlineError
src/ui/sidebar.tsx                  # T15.1 mobile backdrop overlay
src/config/index.ts                 # T15.2 runtimeSchema (strict DATABASE_URL), validateRuntimeEnv
src/instrumentation.ts              # T15.2 register() calls validateRuntimeEnv — fails fast at startup
src/server/app-container.ts         # T15.2 removed silent fallbacks, calls loadConfig directly
Dockerfile                          # T15.3 multi-stage Node 24 Alpine, standalone output, non-root user
docker-compose.yml                  # T15.3 db + migrate + app with health checks and dependency order
.env.production.example             # T15.3 documented production env vars
next.config.ts                      # T15.3 output: "standalone"
scripts/seed.ts                     # T15.3 dev seed script (sample story + character)
README.md                           # T15.4 prerequisites, local setup, env vars, docker, architecture
```

### Decisions / deviations

- **`instrumentation.ts` for startup validation:** Next.js `register()` runs once before the first request; it's the canonical hook for early server-side checks without blocking the edge runtime.
- **`runtimeSchema` separate from `configSchema`:** tests import `loadConfig` (which uses the lenient schema without requiring `DATABASE_URL`); production only uses `validateRuntimeEnv` (strict schema) via `instrumentation.ts`.
- **Docker non-root user:** `nextjs` (uid 1001) with `nodejs` group follows Next.js standalone output conventions.

---

## Phase 16: Manual Authoring & Direct Entity Creation — COMPLETE (T16.1–T16.5)

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all pass.

### Files created/changed

```
src/app/api/stories/[id]/extract-text/route.ts              # T16.1 text → extraction (same pipeline as audio)
src/app/api/stories/[id]/entities/route.ts                  # T16.2 POST direct entity creation; auto-registers builtins
src/app/api/stories/[id]/entities/[entityId]/references/route.ts  # entity backlinks (scenes that @-mention entity)
src/ui/entity-create-modal.tsx                              # T16.4 modal: type selector + name + aliases + dynamic attrs
src/ui/media-upload.tsx                                     # T16.5 portrait/gallery upload with remove button
src/ui/entity-detail.tsx                                    # media section for supportsMedia types
src/ui/character-screen.tsx                                 # portrait upload + gallery in overview tab
```

### Decisions / deviations

- **Multi-valued attribute coercion:** form inputs store `multi: true` values as comma-separated strings; the `save()` function in `EntityDetail` coerces them to arrays before sending to the API to satisfy `validateAttributes`.

---

## Phase 17: Multi-Story Dashboard, Chapters & Prose Editor, @mention System — COMPLETE

New capabilities added: multi-story routing, per-story layouts with chapters and prose scenes, a prose editor with `@[Name](id)` mention syntax, entity backlinks, a unified entity page for all entity types, entity drawer, chapter create modal, Narrate widget, and story title inline editing with localStorage auto-sync.

### Acceptance verification (all pass)

- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors.
- `npm test` — all pass.

### Files created/changed

**Routing & Layout**
```
src/app/page.tsx                                      # multi-story dashboard (story list + create form)
src/app/story/[storyId]/layout.tsx                   # per-story layout with sidebar
src/app/story/[storyId]/page.tsx                     # story bible at /story/[storyId]
src/app/story/[storyId]/talk/page.tsx                # narrate screen per-story
src/app/story/[storyId]/scene/[id]/page.tsx          # scene prose editor per-story
src/app/story/[storyId]/character/[id]/page.tsx      # character page per-story
src/app/story/[storyId]/entity/[entityId]/page.tsx   # unified entity page for any type
```

**Chapters & Prose Scenes**
```
drizzle/schema.ts                                         # chapters table + scenes.(content|chapter_id|position)
drizzle/migrations/0002_whole_clint_barton.sql            # scenes.content column
drizzle/migrations/0003_chapters-and-scene-content.sql    # chapters table + scenes FK/position
src/domain/chapters.ts                                    # Chapter domain type
src/domain/scenes.ts                                      # extended: content, chapterId, position
src/container/story-world-store.ts                        # +listChapters/createChapter/updateChapter/deleteChapter,
                                                          #  listProseScenes/getProseScene/createProseScene/
                                                          #  updateProseScene/deleteProseScene, updateStoryTitle
src/adapters/postgres/story-world-store.ts                # SQL implementations for all new methods
src/adapters/mock/story-world-store.ts                    # in-memory implementations
src/app/api/stories/[id]/route.ts                         # +PATCH handler for story title update
src/app/api/stories/[id]/chapters/route.ts                # GET list + POST create
src/app/api/stories/[id]/chapters/[chapterId]/route.ts    # PATCH + DELETE
src/app/api/stories/[id]/chapters/[chapterId]/scenes/route.ts  # POST create scene in chapter
src/app/api/stories/[id]/scenes/[sceneId]/route.ts        # GET + PATCH + DELETE
```

**@Mention System & Prose Editor**
```
src/ui/mention-input.tsx       # contenteditable editor with @ autocomplete dropdown + HoverCard on hover
src/ui/scene-renderer.tsx      # renders @[Name](id) syntax as clickable mention chips (span, not Link)
src/ui/scene-detail-screen.tsx # prose editor: 1.5s debounce autosave, title autosave (1s),
                               #   onEntityClick → entity drawer, fires novel-os:world-changed on title change
```

**Entity Drawer & Unified Entity Pages**
```
src/ui/entity-drawer.tsx      # right-side slide-in (w-80, z-50); Escape/outside click to close
src/ui/entity-screen.tsx      # unified Overview/Edit/References tabs for any entity type
src/ui/entity-references.tsx  # lists prose scenes that @-mention the entity
```

**Dashboard, Sidebar & UX**
```
src/ui/dashboard.tsx             # multi-story list + create; PATCHes title to DB before navigation
src/ui/sidebar.tsx               # chapters/scenes tree; ChapterCreateModal; novel-os:world-changed listener
src/ui/chapter-create-modal.tsx  # proper modal for chapter title input (no window.prompt())
src/ui/entity-list.tsx           # all entity types in filter pills; unified /entity/[id] links
src/ui/story-screen.tsx          # inline title editing (1s debounce); localStorage auto-sync;
                                 #   "Narrate" copy (was "Talk"); Rules of Hooks moved before early returns
```

**Mock Adapters (relocated to src)**
```
src/adapters/mock/               # clock, job-queue, llm, sdk-model, story-world-store, stt, transcript-store
src/adapters/mock/container.ts   # mock container builder (moved from tests/mocks/memory-container.ts)
src/adapters/mock/index.ts       # barrel
```

### Decisions / deviations

- **Mock adapters in `src/adapters/mock/`:** dev server needs injectable mocks without importing from `tests/`; moving them to src makes the dependency direction valid. The previous location (`tests/mocks/`) was appropriate before the dev server needed them.
- **Story title sync:** `Dashboard.create` PATCHes the title before `router.push()` so the DB row is never "Untitled story" on first load; a `useEffect` auto-sync in `StoryScreen` patches any existing stories that still carry the placeholder by reading the localStorage entry.
- **Prose scenes vs. extraction scenes:** the existing `Scene` domain type (LLM-extracted, with `settingId`, `participantIds`, etc.) is preserved; prose scenes are a separate authoring layer with a simpler schema (title + markdown-style content stored as the `@[Name](id)` format).
- **Entity drawer vs. full navigation:** clicking an `@[Name]` chip opens the lightweight drawer for quick lookup; the full entity page is still accessible via "Open full page →" in the drawer footer.
- **`novel-os:world-changed` event bus:** cross-component refresh (sidebar ↔ scene editor ↔ story bible) uses a `CustomEvent` dispatched on `window`, keyed by `storyId`; avoids prop-drilling refresh callbacks across the layout boundary.