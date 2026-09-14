import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TranscriptProcessor } from "@/services/llm-agent/transcript-processor";
import type { ToolCall } from "@/services/llm-agent/tools/definitions";
import type { StoryWorldStore } from "@/container/story-world-store";
import type { Commit } from "@/domain/commits";
import { activeFacts } from "@/domain/commits";
import type { EntityType } from "@/domain";
import { MAX_FETCHES, MAX_TOOL_CALLS } from "@/services/llm-agent/tools/definitions";
import { createMockStoryWorldStore, scriptedModel } from "../../mocks";

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();

function tool(name: string, args: Record<string, unknown>, id = `${name}-1`): ToolCall {
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

async function seedWorld(): Promise<StoryWorldStore> {
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
  await store.commit(
    commit({
      newEntityTypes: [characterType],
      entities: [
        {
          id: randomUUID(),
          storyId: STORY_ID,
          entityTypeId: characterType.id,
          name: "Nadia",
          aliases: [],
          attributes: {},
          media: [],
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    }),
  );
  return store;
}

describe("TranscriptProcessor (T5.4 agent loop, AI SDK)", () => {
  it("extracts and commits a chapter chunk driven by a scripted model", async () => {
    const store = createMockStoryWorldStore();
    const model = scriptedModel([
      { toolCalls: [tool("list_entity_types", { storyId: STORY_ID })] },
      {
        toolCalls: [
          tool("stage_create_entity_type", {
            name: "starship",
            pluralName: "starships",
            baseKind: "physical",
          }),
        ],
      },
      {
        toolCalls: [
          tool("stage_create_entity", {
            entityTypeName: "starship",
            name: "The Relentless",
            aliases: ["Relentless"],
          }),
        ],
      },
      {
        toolCalls: [
          tool("stage_create_fact", {
            subject: "The Relentless",
            predicate: "is_captained_by",
            objectValue: "Aria Voss",
            confidence: "explicit",
          }),
        ],
      },
      { toolCalls: [tool("finish", {}, "finish-1")] },
    ]);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "Aria captains the Relentless." },
    );

    expect(result.chunks).toHaveLength(1);
    expect(result.commitResults).toHaveLength(1);
    const commitResult = result.commitResults[0];
    expect(commitResult.entityTypesCreated).toBe(1);
    expect(commitResult.entitiesCreated).toBe(1);
    expect(commitResult.factsAdded).toBe(1);
    expect(result.chunks[0].toolCalls).toBe(5);
    expect(result.chunks[0].stoppedReason).toBe("finished");

    const world = await store.getWorld(STORY_ID);
    expect(world?.entityTypes.find((t) => t.name === "starship")?.origin).toBe("extracted");
    expect(world?.entities).toHaveLength(1);
    expect(world?.facts).toHaveLength(1);
    expect(world?.facts[0].provenance.dictationId).toBe(DICTATION_ID);
    expect(world?.facts[0].provenance.textChunk).toContain("Relentless");
  });

  it("is a no-op for an empty transcript", async () => {
    const store = createMockStoryWorldStore();
    const model = scriptedModel([]);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "   " },
    );

    expect(result.chunks).toHaveLength(0);
    expect(result.commitResults).toHaveLength(0);
    expect(await store.getWorld(STORY_ID)).toBeNull();
  });

  it("is a no-op when the model stages nothing and stops without tools", async () => {
    const store = await seedWorld();
    const model = scriptedModel([{ content: "nothing new in this chapter." }]);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "Calm waters." },
    );

    expect(result.chunks[0].stoppedReason).toBe("no-tool-calls");
    expect(result.commitResults).toHaveLength(0);
    expect((await store.getWorld(STORY_ID))!.revision).toBe(1);
  });

  it("guards the tool-call budget and still commits the staged subset", async () => {
    const store = createMockStoryWorldStore();
    const script = Array.from({ length: 46 }, (_, i) => ({
      toolCalls: [
        tool("stage_create_fact", {
          subject: `Ship ${i}`,
          predicate: "has_captain",
          objectValue: `Captain ${i}`,
          confidence: "implied",
        }),
      ],
    }));
    script.push({ toolCalls: [tool("finish", {}, "finish-1")] });
    const model = scriptedModel(script);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "Ships, ships, ships." },
    );

    expect(result.chunks[0].stoppedReason).toBe("tool-call-limit");
    expect(result.chunks[0].toolCalls).toBe(MAX_TOOL_CALLS);
    expect(result.commitResults).toHaveLength(1);
    expect(result.commitResults[0].factsAdded).toBe(MAX_TOOL_CALLS);
  });

  it("guards the entity-fetch budget on get_entities", async () => {
    const store = await seedWorld();
    const world = await store.getWorld(STORY_ID);
    const characterTypeId = world!.entityTypes[0].id;

    const bulk: Commit = commit({ appliedFromRevision: 1 });
    bulk.newEntityTypes = [];
    bulk.entities = Array.from({ length: 300 }, (_, i) => ({
      id: randomUUID(),
      storyId: STORY_ID,
      entityTypeId: characterTypeId,
      name: `Person ${i}`,
      aliases: [],
      attributes: {},
      media: [],
      createdAt: new Date(),
    }));
    await store.commit(bulk);

    const script = Array.from({ length: 5 }, (_, i) => ({
      toolCalls: [
        tool("get_entities", {
          storyId: STORY_ID,
          entityTypeId: characterTypeId,
          limit: 500,
        }, `get-${i}`),
      ],
    }));
    const model = scriptedModel(script);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "Many people." },
    );

    expect(result.chunks[0].stoppedReason).toBe("fetch-limit");
    expect(result.chunks[0].fetches).toBe(MAX_FETCHES);
    expect(result.commitResults).toHaveLength(0);
  });

  it("supersedes a contradictory fact when the agent stages the new claim", async () => {
    const store = await seedWorld();
    const oldFactId = randomUUID();
    await store.commit(
      commit({
        appliedFromRevision: 1,
        facts: [
          {
            id: oldFactId,
            subject: "Nadia",
            predicate: "home_port",
            objectValue: "Coruscant",
            confidence: "explicit",
            provenance: { dictationId: DICTATION_ID, textChunk: "seed", confidence: "explicit" },
            supersededBy: null,
            createdAt: new Date(),
          },
        ],
      }),
    );

    const model = scriptedModel([
        {
          toolCalls: [
            tool("stage_create_fact", {
              subject: "Nadia",
              predicate: "home_port",
              objectValue: "Nar Shaddaa",
              confidence: "implied",
            }),
          ],
        },
        { toolCalls: [tool("supersede_fact", { factId: oldFactId })] },
        { toolCalls: [tool("finish", {}, "finish-1")] },
      ]);

    const result = await new TranscriptProcessor({ model, store }).process(
      { storyId: STORY_ID, dictationId: DICTATION_ID, transcript: "Nadia calls Nar Shaddaa home now." },
    );

    const commitResult = result.commitResults[0];
    expect(commitResult.factsAdded).toBe(1);
    expect(commitResult.contradictionsFound).toBe(1);
    expect(commitResult.factsSuperseded).toBe(1);

    const world = await store.getWorld(STORY_ID);
    const active = activeFacts(world!);
    expect(active).toHaveLength(1);
    expect(active[0].objectValue).toBe("Nar Shaddaa");
  });
});