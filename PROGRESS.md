# NovelOS — PROGRESS

Live status of implementation against `ACTIONS.md`. Each phase lists tasks with status and acceptance verification. Note anything deviating from the spec under "Notes".

---

## Phase 0: Project Bootstrap — COMPLETE

| Task | Status | Notes |
| --- | --- | --- |
| T0.1 — Initialize Next.js project | ✅ Done | Next.js 16.3.5 (App Router, TypeScript, Tailwind v4, ESLint 9). `npm run dev` serves 200; `npm run lint` clean. |
| T0.2 — Install core dependencies | ✅ Done | zod, drizzle-orm, @trpc/server, uuid, nanoid, @evyweb/ioctopus + dev deps drizzle-kit, vitest, @types/node@24. |
| T0.3 — Configure path aliases | ✅ Done | `@/*` → `./src/*` (pre-set by create-next-app); domain/adapters/application barrels + `@/container` composition root created; `vitest.config.ts` alias; resolution proven in test. |
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
src/application/index.ts    # barrel (placeholder export, filled in Phase 5+)
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
  - `STT_PROVIDER`/`LLM_PROVIDER` default to `"mock"`; real provider values require their API key at runtime (`superRefine`), satisfying "missing required env throws at call time".
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

### Next up

Phase 2 — Database / Persistence (T2.x), once the user un-pauses the build. Do NOT start it autonomously.