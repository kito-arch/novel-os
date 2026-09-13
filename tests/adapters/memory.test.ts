import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { storyChangeSchema, type StoryChangeProposal } from "@/domain/proposals";
import { listActiveFacts } from "@/domain/provenance";
import {
  createMockJobQueue,
  createMockLlm,
  createMockStt,
  createMockStoryWorldStore,
  createMockTranscriptStore,
} from "../mocks";

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();
const TYPE_ID = randomUUID();

function emptyProposal(overrides: Partial<StoryChangeProposal> = {}): StoryChangeProposal {
  return storyChangeSchema.parse({
    entityTypes: [],
    entities: [],
    events: [],
    relationships: [],
    facts: [],
    knowledge: [],
    scenes: [],
    plotThreads: [],
    openQuestions: [],
    contradictions: [],
    ...overrides,
  });
}

describe("memory: MockLlm", () => {
  it("extractStructured returns a parsed fixture or an empty default", async () => {
    const llm = createMockLlm();
    const withFixture = createMockLlm({
      fixtures: {
        "Sarah is afraid": emptyProposal({
          facts: [
            { subject: "Sarah", predicate: "is_afraid", objectValue: "of the dark", confidence: "explicit" },
          ],
        }),
      },
    });

    const hit = await withFixture.extractStructured({
      tier: "cheap",
      systemPrompt: "extract",
      userMessage: "Sarah is afraid of the dark",
      schema: storyChangeSchema,
    });
    expect(hit.data.facts).toHaveLength(1);
    expect(hit.data.facts[0].predicate).toBe("is_afraid");

    const miss = await llm.extractStructured({
      tier: "cheap",
      systemPrompt: "extract",
      userMessage: "nothing here",
      schema: storyChangeSchema,
    });
    expect(miss.data).toEqual(emptyProposal());
  });

  it("complete returns canned strings keyed by substring", async () => {
    const llm = createMockLlm({ completions: { "hello": "well hi" }, defaultCompletion: "ok" });
    expect((await llm.complete({ tier: "cheap", systemPrompt: "", userMessage: "say hello" })).text).toBe("well hi");
    expect((await llm.complete({ tier: "cheap", systemPrompt: "", userMessage: "zzz" })).text).toBe("ok");
  });

  it("chat walks a script of tool calls then a final message", async () => {
    const call = { id: "c1", name: "get_entities", arguments: { entityTypeId: TYPE_ID } };
    const llm = createMockLlm({
      chatScript: [
        { toolCalls: [call] },
        { content: "done" },
      ],
    });

    const first = await llm.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(first.message.toolCalls).toEqual([call]);
    expect(first.message.content).toBeNull();

    const second = await llm.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(second.message.toolCalls).toBeUndefined();
    expect(second.message.content).toBe("done");
  });
});

describe("memory: MockStt", () => {
  it("submits immediately and returns a canned transcript", async () => {
    const stt = createMockStt({ transcript: "hello world", durationSeconds: 5 });
    const { jobId } = await stt.submitTranscription({
      audioBuffer: Buffer.from("fake"),
      mimeType: "audio/mp3",
    });
    expect(jobId).toBe("mock-1");
    expect(await stt.getTranscript(jobId)).toMatchObject({ transcript: "hello world", durationSeconds: 5 });
    expect((await stt.getJobStatus(jobId)).status).toBe("completed");
  });
});

describe("memory: MockStoryWorldStore", () => {
  const starshipType = {
    id: TYPE_ID,
    storyId: STORY_ID,
    name: "starship",
    pluralName: "starships",
    baseKind: "physical" as const,
    description: null,
    attributeDefs: [
      { key: "class", label: "Class", kind: "text" as const, required: true, multi: false },
    ],
    origin: "extracted" as const,
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("commits a register-type + add-entities commit (T3.3 acceptance)", async () => {
    const store = createMockStoryWorldStore();
    const result = await store.commit({
      storyId: STORY_ID,
      appliedFromRevision: 0,
      newEntityTypes: [starshipType],
      entities: [
        {
          id: randomUUID(),
          storyId: STORY_ID,
          entityTypeId: TYPE_ID,
          name: "The Relentless",
          aliases: ["Relentless"],
          attributes: { class: "Falcon-class" },
          media: [],
          createdAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
      entityUpdates: [],
      events: [],
      facts: [],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      contradictions: [],
      supersedeFactIds: [],
    });

    expect(result.entityTypesCreated).toBe(1);
    expect(result.entitiesCreated).toBe(1);
    expect(result.entitiesCreatedByType).toEqual({ starship: 1 });
    expect(result.revision).toBe(1);

    const world = await store.getWorld(STORY_ID);
    expect(world?.entityTypes.map((t) => t.name)).toContain("starship");
    expect(await store.findEntityByName(STORY_ID, "Relentless")).not.toBeNull();
    expect(await store.byRevision(STORY_ID, 1)).not.toBeNull();
    expect(await store.byRevision(STORY_ID, 0)).toBeNull();
  });

  it("enforces applyCommit validation gates", async () => {
    const store = createMockStoryWorldStore();
    const base = {
      storyId: STORY_ID,
      appliedFromRevision: 0,
      newEntityTypes: [starshipType],
      entityUpdates: [],
      events: [],
      facts: [],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      contradictions: [],
      supersedeFactIds: [],
    };

    await expect(
      store.commit({
        ...base,
        entities: [
          {
            id: randomUUID(),
            storyId: STORY_ID,
            entityTypeId: TYPE_ID,
            name: "Twin",
            aliases: [],
            attributes: { class: 42 },  // class must be text
            media: [],
            createdAt: new Date(),
          },
        ],
      }),
    ).rejects.toThrow(/applyCommit/);

    // Revision mismatch on a follow-up commit
    await store.commit({ ...base, entities: [] });
    await expect(
      store.commit({ ...base, appliedFromRevision: 3, entities: [] }),
    ).rejects.toThrow(/revision mismatch/);
  });

  it("supersedes facts like the agent's supersede_fact tool", async () => {
    const store = createMockStoryWorldStore();
    const factId = randomUUID();
    const fact = {
      id: factId,
      subject: "The Relentless",
      predicate: "is_captained_by",
      objectValue: "Sarah",
      confidence: "explicit" as const,
      provenance: {
        dictationId: DICTATION_ID,
        textChunk: "Sarah captains the Relentless",
        confidence: "explicit" as const,
      },
      supersededBy: null,
      createdAt: new Date(),
    };

    await store.commit({
      storyId: STORY_ID,
      appliedFromRevision: 0,
      newEntityTypes: [],
      entities: [],
      entityUpdates: [],
      events: [],
      facts: [fact],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      contradictions: [],
      supersedeFactIds: [],
    });

    const supersede = await store.commit({
      storyId: STORY_ID,
      appliedFromRevision: 1,
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
      contradictions: [],
      supersedeFactIds: [factId],
    });
    expect(supersede.factsSuperseded).toBe(1);

    const world = await store.getWorld(STORY_ID);
    expect(listActiveFacts(world!.facts)).toHaveLength(0);
  });

  it("matches entities by name or alias case-insensitively", async () => {
    const store = createMockStoryWorldStore();
    await store.upsertEntityType(STORY_ID, {
      storyId: STORY_ID,
      name: "character",
      pluralName: "characters",
      baseKind: "character",
      description: null,
      attributeDefs: [],
      origin: "core",
      supersededBy: null,
    });
    const type = await store.findEntityTypeByName(STORY_ID, "Character");
    expect(type?.name).toBe("character");
  });
});

describe("memory: MockTranscriptStore", () => {
  it("round-trips dictations and correlates by provider job id", async () => {
    const store = createMockTranscriptStore();
    const id = await store.saveDictation({
      storyId: STORY_ID,
      userId: "u1",
      status: "pending",
    });
    await store.updateDictation(id, { providerJobId: "transcript_abc", status: "processing" });

    const row = await store.getDictation(id);
    expect(row?.status).toBe("processing");
    expect(row?.providerJobId).toBe("transcript_abc");

    const byJob = await store.findDictationByProviderJobId("transcript_abc");
    expect(byJob).toMatchObject({ id, storyId: STORY_ID, userId: "u1" });
    expect(await store.findDictationByProviderJobId("nope")).toBeNull();

    const scoped = await store.listDictations({ storyId: STORY_ID, userId: "u1" });
    expect(scoped).toHaveLength(1);
    expect(await store.listDictations({ storyId: STORY_ID, userId: "u2" })).toHaveLength(0);
  });
});

describe("memory: MockJobQueue", () => {
  it("enqueue triggers the completed handler and reports status", async () => {
    const queue = createMockJobQueue();
    const seen: unknown[] = [];
    queue.onJobCompleted("extraction", async (data) => {
      seen.push(data);
    });
    const payload = { dictationId: DICTATION_ID, storyId: STORY_ID };
    const { jobId } = await queue.enqueue("extraction", payload);
    expect(seen).toEqual([payload]);
    expect(await queue.getStatus(jobId)).toBe("completed");
  });

  it("routes handler failures to onJobFailed", async () => {
    const queue = createMockJobQueue();
    let failed: Error | undefined;
    queue.onJobCompleted("extraction", async () => {
      throw new Error("boom");
    });
    queue.onJobFailed("extraction", async (_data, error) => {
      failed = error;
    });
    const { jobId } = await queue.enqueue("extraction", { dictationId: DICTATION_ID });
    expect(failed?.message).toBe("boom");
    expect(await queue.getStatus(jobId)).toBe("failed");
  });
});