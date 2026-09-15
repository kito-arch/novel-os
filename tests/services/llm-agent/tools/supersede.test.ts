import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StoryToolExecutor } from "@/services/llm-agent/tools/executor";
import { CommitBuilder } from "@/services/llm-agent/tools/build-commit";
import { Session } from "@/services/llm-agent/tools/session";
import {
  TOOL_STAGE_CREATE_FACT,
  TOOL_SUPERSEDE_FACT,
} from "@/services/llm-agent/tools/definitions";
import type { ToolCall } from "@/services/llm-agent/tools/definitions";
import { activeFacts } from "@/domain/commits";
import type { Commit } from "@/domain/commits";
import type { Entity, EntityType } from "@/domain";
import type { Fact } from "@/domain/provenance";
import { createMockStoryWorldStore } from "../../../mocks";

const STORY_ID = randomUUID();
const DICTATION_A = randomUUID();
const DICTATION_B = randomUUID();

function tool(name: string, args: Record<string, unknown> = {}, id = `${name}-1`): ToolCall {
  return { id, name, arguments: args };
}

function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    storyId: STORY_ID,
    appliedFromRevision: 0,
    newEntityTypes: [],
    entities: [],
    entityUpdates: [],
    events: [],
    facts: [],
    relationships: [],
    knowledge: [],
    scenes: [],
    plotThreads: [],
    openQuestions: [],
    resolvedOpenQuestionIds: [],
    contradictions: [],
    supersedeFactIds: [],
    ...overrides,
  };
}

async function seedWithFact(predicate: string, objectValue: string, confidence: Fact["confidence"] = "explicit") {
  const store = createMockStoryWorldStore();
  const characterType: EntityType = {
    id: randomUUID(),
    storyId: STORY_ID,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: null,
    attributeDefs: [],
    origin: "core",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const nadia: Entity = {
    id: randomUUID(),
    storyId: STORY_ID,
    entityTypeId: characterType.id,
    name: "Nadia",
    aliases: [],
    attributes: {},
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const factId = randomUUID();
  await store.commit(commit({
    newEntityTypes: [characterType],
    entities: [nadia],
    facts: [{
      id: factId,
      subject: "Nadia",
      predicate,
      objectValue,
      confidence,
      provenance: { dictationId: DICTATION_A, textChunk: "seed", confidence },
      supersededBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }],
  }));
  return { store, factId };
}

async function exec(
  store: ReturnType<typeof createMockStoryWorldStore>,
  session: ReturnType<typeof Session.create>,
  name: string,
  args: Record<string, unknown> = {},
) {
  return StoryToolExecutor.execute(store, session, tool(name, args));
}

describe("supersede and contradiction edge cases (T14.4)", () => {
  it("same fact restated from world is rejected as a duplicate (no contradiction)", async () => {
    const { store } = await seedWithFact("rank", "Commander");
    const session = Session.create(STORY_ID);

    const result = await exec(store, session, TOOL_STAGE_CREATE_FACT, {
      subject: "Nadia",
      predicate: "rank",
      objectValue: "Commander",
      confidence: "explicit",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("already a recorded fact");
    expect(session.contradictions).toHaveLength(0);
    expect(session.facts).toHaveLength(0);
  });

  it("same fact staged twice in one session is idempotent (ok, not an error)", async () => {
    const store = createMockStoryWorldStore();
    const session = Session.create(STORY_ID);

    await exec(store, session, TOOL_STAGE_CREATE_FACT, {
      subject: "Aria",
      predicate: "rank",
      objectValue: "Captain",
      confidence: "explicit",
    });
    const second = await exec(store, session, TOOL_STAGE_CREATE_FACT, {
      subject: "Aria",
      predicate: "rank",
      objectValue: "Captain",
      confidence: "explicit",
    });

    expect(second.ok).toBe(true);
    expect(second.message).toContain("already staged");
    expect(session.facts).toHaveLength(1);
  });

  it("contradictory fact surfaces a warning and queues the old fact for supersede automatically", async () => {
    const { store, factId } = await seedWithFact("rank", "Commander");
    const session = Session.create(STORY_ID);

    const result = await exec(store, session, TOOL_STAGE_CREATE_FACT, {
      subject: "Nadia",
      predicate: "rank",
      objectValue: "Admiral",
      confidence: "explicit",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("contradicts");
    expect(session.contradictions).toHaveLength(1);
    expect(session.contradictions[0].existingFactId).toBe(factId);
    expect(session.supersedeFactIds).toContain(factId);
    expect(session.facts).toHaveLength(1);
    expect(session.facts[0].objectValue).toBe("Admiral");
  });

  it("staging the same contradiction twice does not add a duplicate contradiction record", async () => {
    const { store } = await seedWithFact("rank", "Commander");
    const session = Session.create(STORY_ID);

    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Nadia", predicate: "rank", objectValue: "Admiral", confidence: "explicit" });
    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Nadia", predicate: "rank", objectValue: "Fleet Admiral", confidence: "explicit" });

    expect(session.contradictions).toHaveLength(1);
  });

  it("explicit supersede_fact call is accepted and idempotent in supersedeFactIds", async () => {
    const { store, factId } = await seedWithFact("rank", "Commander");
    const session = Session.create(STORY_ID);

    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Nadia", predicate: "rank", objectValue: "Admiral", confidence: "explicit" });
    const explicit = await exec(store, session, TOOL_SUPERSEDE_FACT, { factId });

    expect(explicit.ok).toBe(true);
    const count = session.supersedeFactIds.filter((id) => id === factId).length;
    expect(count).toBe(1);
  });

  it("confidence strata are preserved through the full session → commit flow", async () => {
    const store = createMockStoryWorldStore();
    const session = Session.create(STORY_ID);

    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Aria", predicate: "allegiance", objectValue: "Empire", confidence: "explicit" });
    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Aria", predicate: "motive", objectValue: "survival", confidence: "implied" });

    await CommitBuilder.buildFromStaged(store, session, { dictationId: DICTATION_A, textChunk: "Aria serves the Empire to survive." });

    const world = await store.getWorld(STORY_ID);
    const facts = world!.facts;
    expect(facts.find((f) => f.predicate === "allegiance")?.confidence).toBe("explicit");
    expect(facts.find((f) => f.predicate === "motive")?.confidence).toBe("implied");
  });

  it("commit marks the old fact superseded and leaves only the new one active", async () => {
    const { store, factId } = await seedWithFact("rank", "Commander");
    const session = Session.create(STORY_ID);

    await exec(store, session, TOOL_STAGE_CREATE_FACT, { subject: "Nadia", predicate: "rank", objectValue: "Admiral", confidence: "explicit" });
    const result = await CommitBuilder.buildFromStaged(store, session, { dictationId: DICTATION_B, textChunk: "Nadia is now an Admiral." });

    expect(result!.factsAdded).toBe(1);
    expect(result!.factsSuperseded).toBe(1);
    expect(result!.contradictionsFound).toBe(1);

    const world = await store.getWorld(STORY_ID);
    const active = activeFacts(world!);
    expect(active).toHaveLength(1);
    expect(active[0].objectValue).toBe("Admiral");
    expect(world!.facts.find((f) => f.id === factId)?.supersededBy).not.toBeNull();
  });

  it("cross-chapter contradiction: fact from dictation A is superseded by dictation B extraction", async () => {
    const store = createMockStoryWorldStore();

    // Session A: establish "Aria rank Commander"
    const sessionA = Session.create(STORY_ID);
    await exec(store, sessionA, TOOL_STAGE_CREATE_FACT, { subject: "Aria", predicate: "rank", objectValue: "Commander", confidence: "explicit" });
    await CommitBuilder.buildFromStaged(store, sessionA, { dictationId: DICTATION_A, textChunk: "Aria is a Commander." });

    const worldAfterA = await store.getWorld(STORY_ID);
    const oldFactId = worldAfterA!.facts[0].id;

    // Session B (later chapter): "Aria rank Admiral" contradicts session A
    const sessionB = Session.create(STORY_ID);
    const warning = await exec(store, sessionB, TOOL_STAGE_CREATE_FACT, { subject: "Aria", predicate: "rank", objectValue: "Admiral", confidence: "explicit" });
    expect(warning.ok).toBe(true);
    expect(warning.message).toContain("contradicts");
    expect(sessionB.supersedeFactIds).toContain(oldFactId);

    const result = await CommitBuilder.buildFromStaged(store, sessionB, { dictationId: DICTATION_B, textChunk: "Aria is now an Admiral." });
    expect(result!.factsSuperseded).toBe(1);

    const worldAfterB = await store.getWorld(STORY_ID);
    expect(activeFacts(worldAfterB!).map((f) => f.objectValue)).toEqual(["Admiral"]);
    // Provenance of the new fact is from dictation B
    expect(activeFacts(worldAfterB!)[0].provenance.dictationId).toBe(DICTATION_B);
  });
});
