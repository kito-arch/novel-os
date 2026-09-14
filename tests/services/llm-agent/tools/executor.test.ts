import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StoryToolExecutor } from "@/services/llm-agent/tools/executor";
import { Session, type ExtractionSession } from "@/services/llm-agent/tools/session";
import {
  MAX_FETCHES,
  MAX_TOOL_CALLS,
  TOOL_FINISH,
  TOOL_GET_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_LIST_ENTITY_TYPES,
  TOOL_STAGE_CREATE_ENTITY,
  TOOL_STAGE_CREATE_ENTITY_TYPE,
  TOOL_STAGE_CREATE_FACT,
  TOOL_STAGE_CREATE_RELATIONSHIP,
  TOOL_STAGE_RESOLVE_OPEN_QUESTION,
  TOOL_STAGE_UPDATE_ENTITY,
  TOOL_SUPERSEDE_FACT,
  type ToolResult,
} from "@/services/llm-agent/tools/definitions";
import type { ToolCall } from "@/services/llm-agent/tools/definitions";
import type { StoryWorldStore } from "@/container/story-world-store";
import type { Commit, CommitResult } from "@/domain/commits";
import { activeFacts } from "@/domain/commits";
import type { Entity, EntityType } from "@/domain";
import { createMockStoryWorldStore } from "../../../mocks";

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();

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

interface SeededStore {
  store: StoryWorldStore;
  characterType: EntityType;
  nadia: Entity;
  factId: string;
  questionId: string;
}

async function seedWorld(): Promise<SeededStore> {
  const store = createMockStoryWorldStore();
  const characterType: EntityType = {
    id: randomUUID(),
    storyId: STORY_ID,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: null,
    attributeDefs: [{ key: "home", label: "Home", kind: "text", required: false, multi: false }],
    origin: "core",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const nadia: Entity = {
    id: randomUUID(),
    storyId: STORY_ID,
    entityTypeId: characterType.id,
    name: "Nadia",
    aliases: ["Nads"],
    attributes: { home: "Gereon" },
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const factId = randomUUID();
  const questionId = randomUUID();
  await store.commit(
    commit({
      newEntityTypes: [characterType],
      entities: [nadia],
      facts: [
        {
          id: factId,
          subject: "Nadia",
          predicate: "fears",
          objectValue: "the dark",
          confidence: "explicit",
          provenance: { dictationId: DICTATION_ID, textChunk: "seed", confidence: "explicit" },
          supersededBy: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      openQuestions: [
        {
          id: questionId,
          question: "Who fired first?",
          relatedEntityIds: [],
          introducedInDictationId: DICTATION_ID,
          resolvedInDictationId: null,
          isResolved: false,
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    }),
  );
  return { store, characterType, nadia, factId, questionId };
}

function sessionFor(): { session: ExtractionSession; exec: typeof StoryToolExecutor } {
  return { session: Session.create(STORY_ID), exec: StoryToolExecutor };
}

async function run(
  store: StoryWorldStore,
  session: ExtractionSession,
  exec: typeof StoryToolExecutor,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  return exec.execute(store, session, tool(name, args));
}

describe("story-tools executor", () => {
  it("list_entity_types returns the registry plus just-staged types", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();
    const staged = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "starship",
      pluralName: "starships",
      baseKind: "physical",
    });
    expect(staged.ok).toBe(true);

    const result = await run(store, session, exec, TOOL_LIST_ENTITY_TYPES);
    expect(result.ok).toBe(true);
    const types = (result.data as { entityTypes: Array<{ name: string; staged: boolean }> }).entityTypes;
    expect(types.find((t) => t.name === "character")?.staged).toBe(false);
    expect(types.find((t) => t.name === "starship")?.staged).toBe(true);
  });

  it("validates staged entity types against base kind + attribute defs", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();

    const badKind = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "velociraptor",
      pluralName: "velociraptors",
      baseKind: "animal",
    });
    expect(badKind.ok).toBe(false);
    expect(badKind.message).toContain("baseKind");

    const badDefs = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "droid",
      pluralName: "droids",
      baseKind: "physical",
      attributeDefs: [
        { key: "class", label: "Class", kind: "enum" },
        { key: "core", label: "Core", kind: "ref" },
      ],
    });
    expect(badDefs.ok).toBe(false);
    expect(badDefs.message).toContain("enum");
  });

  it("rejects a duplicate or already-registered entity type", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();
    const duplicate = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "character",
      pluralName: "characters",
      baseKind: "character",
    });
    expect(duplicate.ok).toBe(false);
    const duplicateStaged = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "starship",
      pluralName: "starships",
      baseKind: "physical",
    });
    expect(duplicateStaged.ok).toBe(true);
    const again = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "Starship",
      pluralName: "starships",
      baseKind: "physical",
    });
    expect(again.ok).toBe(false);
  });

  it("stages entities against registry or staged types and validates attributes", async () => {
    const { store, characterType } = await seedWorld();
    const { session, exec } = sessionFor();

    const unknownType = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "velociraptor",
      name: "Rex",
    });
    expect(unknownType.ok).toBe(false);
    expect(unknownType.message).toContain("unknown entity type");

    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "starship",
      pluralName: "starships",
      baseKind: "physical",
    });
    const invalid = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Aria",
      attributes: { home: 42 },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.message).toContain("attributes are invalid");

    const character = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Aria Voss",
      attributes: { home: "Gereon" },
    });
    expect(character.ok).toBe(true);

    const created = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "starship",
      name: "The Relentless",
      aliases: ["Relentless"],
    });
    expect(created.ok).toBe(true);
    const stagedId = (created.data as { stagedEntityId: string }).stagedEntityId;

    const duplicate = await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "starship",
      name: "the relentless",
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.message).toContain("already exists");

    const fetched = await run(store, session, exec, TOOL_GET_ENTITY, {
      storyId: STORY_ID,
      entityId: stagedId,
    });
    expect(fetched.ok).toBe(true);
    expect((fetched.data as { name: string }).name).toBe("The Relentless");

    const list = await run(store, session, exec, TOOL_GET_ENTITIES, {
      storyId: STORY_ID,
      entityTypeId: characterType.id,
      limit: 10,
    });
    const entities = (list.data as { entities: Array<{ name: string; staged: boolean }> }).entities;
    expect(entities.find((e) => e.name === "Nadia")?.staged).toBe(false);
    expect(entities.find((e) => e.name === "Aria Voss")?.staged).toBe(true);
  });

  it("stage_update_entity merges values and validates the merged result", async () => {
    const { store, nadia } = await seedWorld();
    const { session, exec } = sessionFor();

    const fine = await run(store, session, exec, TOOL_STAGE_UPDATE_ENTITY, {
      entityId: nadia.id,
      attributes: { home: "Nar Shaddaa" },
    });
    expect(fine.ok).toBe(true);

    const invalid = await run(store, session, exec, TOOL_STAGE_UPDATE_ENTITY, {
      entityId: nadia.id,
      attributes: { home: 42 },
    });
    expect(invalid.ok).toBe(false);

    const unknown = await run(store, session, exec, TOOL_STAGE_UPDATE_ENTITY, {
      entityId: randomUUID(),
      attributes: { home: "X" },
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain("not found");
  });

  it("stage_create_fact flags contradictions and queues the old fact for supersede", async () => {
    const { store, factId } = await seedWorld();
    const { session, exec } = sessionFor();

    const conflicting = await run(store, session, exec, TOOL_STAGE_CREATE_FACT, {
      subject: "Nadia",
      predicate: "fears",
      objectValue: "heights",
      confidence: "implied",
    });
    expect(conflicting.ok).toBe(true);
    expect(conflicting.message).toContain("contradicts");
    expect(session.supersedeFactIds).toContain(factId);
    expect(session.contradictions[0].existingFactId).toBe(factId);

    const supersede = await run(store, session, exec, TOOL_SUPERSEDE_FACT, {
      factId,
    });
    expect(supersede.ok).toBe(true);
  });

  it("supersede_fact guards unknown and already-superseded facts", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();
    expect((await run(store, session, exec, TOOL_SUPERSEDE_FACT, { factId: randomUUID() })).ok).toBe(false);
  });

  it("stage_resolve_open_question only resolves existing unresolved questions", async () => {
    const { store, questionId } = await seedWorld();
    const { session, exec } = sessionFor();

    const resolved = await run(store, session, exec, TOOL_STAGE_RESOLVE_OPEN_QUESTION, {
      question: "Who fired first?",
    });
    expect(resolved.ok).toBe(true);
    expect(session.resolvedOpenQuestionIds).toContain(questionId);

    const unknown = await run(store, session, exec, TOOL_STAGE_RESOLVE_OPEN_QUESTION, {
      question: "Who invented hyperspace?",
    });
    expect(unknown.ok).toBe(false);
    expect(unknown.message).toContain("no unresolved open question");
  });

  it("stage_create_relationship rejects unknown entity names", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();
    const result = await run(store, session, exec, TOOL_STAGE_CREATE_RELATIONSHIP, {
      fromEntityName: "Gex",
      toEntityName: "Nadia",
      kind: "rival_of",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not known");
  });

  it("get_entities clamps pagination and enforces the fetch budget", async () => {
    const { store, characterType } = await seedWorld();
    const { session, exec } = sessionFor();

    let revision = 1;
    for (const name of ["Beta", "Gamma", "Delta", "Epsilon"]) {
      await store.commit(
        commit({
          appliedFromRevision: revision,
          entities: [
            {
              id: randomUUID(),
              storyId: STORY_ID,
              entityTypeId: characterType.id,
              name,
              aliases: [],
              attributes: {},
              media: [],
              createdAt: new Date(),
            },
          ],
        }),
      );
      revision += 1;
    }

    const page = await run(store, session, exec, TOOL_GET_ENTITIES, {
      storyId: STORY_ID,
      entityTypeId: characterType.id,
      limit: 2,
      offset: 1,
    });
    const paged = (page.data as { entities: unknown[] }).entities;
    expect(paged).toHaveLength(2);

    // Budget: keep issuing fetches until the cumulative cap is hit.
    session.counters.fetchedEntities = MAX_FETCHES;
    const exhausted = await run(store, session, exec, TOOL_GET_ENTITIES, {
      storyId: STORY_ID,
      entityTypeId: characterType.id,
    });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.message).toContain("budget exhausted");
  });

  it("finish errors until at least one change is staged", async () => {
    const { store } = await seedWorld();
    const { session, exec } = sessionFor();

    const premature = await run(store, session, exec, TOOL_FINISH);
    expect(premature.ok).toBe(false);
    expect(premature.message).toContain("no staged changes");

    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Aria",
    });
    const done = await run(store, session, exec, TOOL_FINISH);
    expect(done.ok).toBe(true);
    expect((done.data as { entities: number }).entities).toBe(1);
  });

  it("hard-stops dispatch once the tool-call budget is spent", async () => {
    const { store } = await seedWorld();
    const session = Session.create(STORY_ID);
    session.counters.toolCalls = MAX_TOOL_CALLS;

    const result = await StoryToolExecutor.execute(
      store,
      session,
      tool(TOOL_GET_ENTITIES, { storyId: STORY_ID, entityTypeId: "any" }),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("budget exhausted");
  });

  it("commits staged world changes exactly as the agent staged them", async () => {
    const { store, characterType } = await seedWorld();
    const { session, exec } = sessionFor();

    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY_TYPE, {
      name: "starship",
      pluralName: "starships",
      baseKind: "physical",
    });
    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "starship",
      name: "The Relentless",
    });
    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Aria Voss",
    });
    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Sarah",
    });
    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Gex",
    });
    await run(store, session, exec, TOOL_STAGE_CREATE_ENTITY, {
      entityTypeName: "character",
      name: "Milo",
    });

    const commitResult: CommitResult | null = await import(
"@/services/llm-agent/tools/build-commit"
    ).then((m) =>
      m.CommitBuilder.buildFromStaged(store, session, {
        dictationId: DICTATION_ID,
        textChunk: "Aria captains the Relentless",
      }),
    );

    expect(commitResult).not.toBeNull();
    expect(commitResult!.entityTypesCreated).toBe(1);
    expect(commitResult!.entitiesCreated).toBe(5);
    expect(commitResult!.revision).toBe(2);

    const world = await store.getWorld(STORY_ID);
    expect(world?.entityTypes.find((t) => t.name === "starship")?.origin).toBe("extracted");
    const relentless = world?.entities.find((e) => e.name === "The Relentless");
    expect(relentless?.entityTypeId).not.toBe(characterType.id);
    const aria = world?.entities.find((e) => e.name === "Aria Voss");
    expect(aria?.entityTypeId).toBe(characterType.id);
  });

  it("supersedes the conflicting fact when a contradiction is committed", async () => {
    const { store, factId } = await seedWorld();
    const { session, exec } = sessionFor();

    await run(store, session, exec, TOOL_STAGE_CREATE_FACT, {
      subject: "Nadia",
      predicate: "fears",
      objectValue: "heights",
      confidence: "implied",
    });
    await run(store, session, exec, TOOL_SUPERSEDE_FACT, { factId });

    const commitResult = await import("@/services/llm-agent/tools/build-commit").then((m) =>
      m.CommitBuilder.buildFromStaged(store, session, {
        dictationId: DICTATION_ID,
        textChunk: "Nadia fears heights",
      }),
    );

    expect(commitResult!.factsAdded).toBe(1);
    expect(commitResult!.factsSuperseded).toBe(1);
    expect(commitResult!.contradictionsFound).toBe(1);

    const world = await store.getWorld(STORY_ID);
    const active = activeFacts(world!);
    expect(active).toHaveLength(1);
    expect(active[0].objectValue).toBe("heights");
    expect(world!.facts[0].supersededBy).not.toBeNull();
  });
});