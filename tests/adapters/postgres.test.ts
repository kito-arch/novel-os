import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { NotImplementedError, buildContainer } from "@/container";
import { PostgresStoryWorldStore, PostgresTranscriptStore } from "@/adapters/postgres";
import { loadConfig } from "@/config";
import * as databaseSchema from "../../drizzle/schema";
import { runStoryWorldStoreContract } from "./support/story-world-store-contract";

// Real-Postgres adapter contract tests (Phase 8). Requires a running Postgres
// and a DATABASE_URL (defaults to the local dev/test instance). The migration
// must already be applied: `DATABASE_URL=postgres://localhost:5432/novelos_test npm run db:migrate`.
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/novelos_test";

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema: databaseSchema });

const TABLE_NAMES = [
  "stories",
  "dictations",
  "entity_types",
  "entities",
  "media",
  "facts",
  "events",
  "relationships",
  "entity_knowledge",
  "scenes",
  "plot_threads",
  "open_questions",
  "contradictions",
  "processing_jobs",
] as const;

// The contract suite reuses one storyId across all of its tests, so every
// factory() call must start from an empty database — exactly what the memory
// adapter's fresh instance provides.
async function truncateAll(): Promise<void> {
  await client.unsafe(
    `TRUNCATE TABLE ${TABLE_NAMES.join(", ")} RESTART IDENTITY CASCADE`,
  );
}

describe("postgres: StoryWorldStore", () => {
  runStoryWorldStoreContract(async () => {
    await truncateAll();
    return new PostgresStoryWorldStore({ db });
  });
});

describe("postgres: TranscriptStore", () => {
  it("round-trips dictations and correlates by provider job id", async () => {
    await truncateAll();
    const store = new PostgresTranscriptStore({ db });

    const storyId = crypto.randomUUID();
    const id = await store.saveDictation({
      storyId,
      userId: "u1",
      status: "pending",
    });
    await store.updateDictation(id, { providerJobId: "transcript_abc", status: "processing" });

    const row = await store.getDictation(id);
    expect(row?.status).toBe("processing");
    expect(row?.providerJobId).toBe("transcript_abc");

    const byJob = await store.findDictationByProviderJobId("transcript_abc");
    expect(byJob).toMatchObject({ id, storyId, userId: "u1" });
    expect(await store.findDictationByProviderJobId("nope")).toBeNull();

    const scoped = await store.listDictations({ storyId, userId: "u1" });
    expect(scoped).toHaveLength(1);
    expect(await store.listDictations({ storyId, userId: "u2" })).toHaveLength(0);

    await expect(
      store.updateDictation(crypto.randomUUID(), { status: "failed" }),
    ).rejects.toThrow(/not found/);
  });
});

describe("postgres: buildContainer (T8.5)", () => {
  it("wires real Postgres adapters when DATABASE_URL is set", async () => {
    const container = buildContainer(
      loadConfig({ LLM_PROVIDER: "mock", DATABASE_URL }),
    );
    expect(container.get("STORY_WORLD_STORE")).toBeInstanceOf(PostgresStoryWorldStore);
    expect(container.get("TRANSCRIPT_STORE")).toBeInstanceOf(PostgresTranscriptStore);
    expect(container.get("CLOCK")).toBeDefined();
    // A real container resolves even before every adapter ships; requesting an
    // unshipped one reports a descriptive error rather than a generic crash.
    expect(() => container.get("LLM")).toThrow(NotImplementedError);
  });

  it("throws a clear NotImplementedError without DATABASE_URL", () => {
    expect(() =>
      buildContainer(loadConfig({ LLM_PROVIDER: "mock" })),
    ).toThrow(/DATABASE_URL/);
  });
});

afterAll(async () => {
  await client.end();
});