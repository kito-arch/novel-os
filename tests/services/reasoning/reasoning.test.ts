import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { askStory } from "@/services/reasoning/ask";
import { doesEntityKnow, knowledgeContext } from "@/services/reasoning/knowledge";
import {
  checkContinuity,
  isReportCategory,
  type AnalysisType,
  type ContinuityReport,
} from "@/services/reasoning/continuity";
import { createMockLlm, createMockStoryWorldStore } from "../../mocks";
import type { LlmClient } from "@/container/llm";
import type { StoryWorldStore } from "@/container/story-world-store";
import type { StoryWorld } from "@/domain/story-world";
import type { Entity } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import type { StoryEvent } from "@/domain/events";
import type { Fact } from "@/domain/provenance";
import type { Relationship } from "@/domain/relationships";
import type { PlotThread } from "@/domain/plot-threads";

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();

function entityType(name: string, pluralName: string, baseKind: EntityType["baseKind"]): EntityType {
  return {
    id: randomUUID(),
    storyId: STORY_ID,
    name,
    pluralName,
    baseKind,
    description: null,
    attributeDefs: [
      { key: "eye-color", label: "Eye color", kind: "text", required: false, multi: false },
      { key: "age", label: "Age", kind: "number", required: false, multi: false },
    ],
    origin: "core",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function entity(name: string, entityTypeId: string): Entity {
  return {
    id: randomUUID(),
    storyId: STORY_ID,
    entityTypeId,
    name,
    aliases: [],
    attributes: { "eye-color": "green", age: 28 },
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fact(subject: string, predicate: string, objectValue: string | null, id = randomUUID(), supersededBy: string | null = null): Fact {
  return {
    id,
    subject,
    predicate,
    objectValue,
    confidence: "explicit",
    provenance: { dictationId: DICTATION_ID, textChunk: "fixture", confidence: "explicit" },
    supersededBy,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function relationship(fromEntityId: string, toEntityId: string, kind: string, supersededBy: string | null = null): Relationship {
  return {
    id: randomUUID(),
    fromEntityId,
    toEntityId,
    kind,
    details: null,
    confidence: "explicit",
    provenance: { dictationId: DICTATION_ID, textChunk: "", confidence: "explicit" },
    supersededBy,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function event(title: string, participantIds: string[], consequences: string[] = []): StoryEvent {
  return {
    id: randomUUID(),
    title,
    description: `${title} happened`,
    settingId: null,
    when: { raw: "chapter 1", normalized: { chapter: "1", order: 1 } },
    motivation: null,
    consequences,
    knowledgeGained: [],
    knowledgeConcealed: [],
    participants: participantIds,
    involvedObjects: [],
    confidence: "inferred",
    provenance: { dictationId: DICTATION_ID, textChunk: "", confidence: "inferred" },
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function thread(title: string, status: PlotThread["status"], lastMentionedInSceneId: string | null): PlotThread {
  return {
    id: randomUUID(),
    title,
    description: null,
    status,
    introducedInSceneId: null,
    lastMentionedInSceneId,
    relatedEntityIds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function baseWorld(sarah: Entity, kaden: Entity, characterType: EntityType): StoryWorld {
  const sarahKnowsJohn = {
    id: randomUUID(),
    subjectEntityId: sarah.id,
    factId: null,
    knowledgeText: "John killed Michael",
    status: "known" as const,
    learnedWhen: "chapter 8",
    learnedVia: "witness",
    createdAt: new Date("2026-01-03T00:00:00Z"),
  };
  return {
    id: STORY_ID,
    title: "Crestfall Rising",
    synopsis: null,
    storyType: null,
    revision: 1,
    entityTypes: [characterType],
    entities: [sarah, kaden],
    facts: [],
    events: [],
    relationships: [],
    knowledge: [sarahKnowsJohn],
    scenes: [],
    plotThreads: [],
    openQuestions: [],
  };
}

function storeWith(world: StoryWorld): StoryWorldStore {
  const store = createMockStoryWorldStore();
  const proxy = Object.create(store) as StoryWorldStore;
  proxy.getWorld = async () => world;
  proxy.getEntity = async (_storyId, entityId) =>
    world.entities.find((candidate) => candidate.id === entityId) ?? null;
  proxy.getEntityTypes = async () => world.entityTypes;
  proxy.findEntityByName = async (_storyId, name) =>
    world.entities.find(
      (candidate) =>
        candidate.name.toLowerCase() === name.toLowerCase() ||
        candidate.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase()),
    ) ?? null;
  proxy.queryEvents = async (_storyId, query) => {
    let events = world.events;
    if (query?.entityId) {
      events = events.filter(
        (item) =>
          item.settingId === query.entityId ||
          item.participants.includes(query.entityId!) ||
          item.involvedObjects.includes(query.entityId!),
      );
    }
    return events;
  };
  proxy.getKnowledge = async (_storyId, subjectEntityId) =>
    world.knowledge.filter((row) => row.subjectEntityId === subjectEntityId);
  proxy.listEntities = async (_storyId, entityTypeId) =>
    entityTypeId
      ? world.entities.filter((item) => item.entityTypeId === entityTypeId)
      : world.entities;
  return proxy;
}

describe("askStory (T7.1)", () => {
  it("returns the LLM answer, routing the question through mention parsing + bounded context", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const kaden = entity("Kaden", characterType.id);
    const world = baseWorld(sarah, kaden, characterType);
    const llm: LlmClient = createMockLlm({ completions: { "What is Sarah": "Sarah is 28 with green eyes." } });

    const answer = await askStory({ store: storeWith(world), llm }, STORY_ID, "What is Sarah?");
    expect(answer).toBe("Sarah is 28 with green eyes.");
  });

  it("rejects empty questions and unknown stories", async () => {
    const characterType = entityType("character", "characters", "character");
    const world = baseWorld(entity("Sarah", characterType.id), entity("Kaden", characterType.id), characterType);
    const llm: LlmClient = createMockLlm();

    await expect(
      askStory({ store: storeWith(world), llm }, STORY_ID, "   "),
    ).rejects.toThrow("question must not be empty");
    const missingStore = Object.create(storeWith(world)) as StoryWorldStore;
    missingStore.getWorld = async () => null;
    await expect(
      askStory({ store: missingStore, llm }, randomUUID(), "What is Sarah?"),
    ).rejects.toThrow("not found");
  });
});

describe("doesEntityKnow (T7.2)", () => {
  const characterType = entityType("character", "characters", "character");
  const sarah = entity("Sarah", characterType.id);
  const kaden = entity("Kaden", characterType.id);
  const store = storeWith(baseWorld(sarah, kaden, characterType));

  it("returns known when the entity learned the fact before the query chapter", async () => {
    const status = await doesEntityKnow(store, STORY_ID, sarah.id, "John killed Michael", "chapter 10");
    expect(status).toBe("known");
  });

  it("returns unknown when the fact was learned after the query chapter (timeline)", async () => {
    const status = await doesEntityKnow(store, STORY_ID, sarah.id, "John killed Michael", "chapter 5");
    expect(status).toBe("unknown");
  });

  it("no timeline -> known without a temporal gate", async () => {
    const status = await doesEntityKnow(store, STORY_ID, sarah.id, "John killed Michael");
    expect(status).toBe("known");
  });

  it("unknown when no claim matches", async () => {
    const status = await doesEntityKnow(store, STORY_ID, kaden.id, "John killed Michael");
    expect(status).toBe("unknown");
  });

  it("knowledgeContext returns matching claims for the /knowledge route explanation", async () => {
    const ctx = await knowledgeContext(store, STORY_ID, sarah.id, "John killed Michael", "chapter 10");
    expect(ctx.status).toBe("known");
    expect(ctx.claims).toHaveLength(1);
    expect(ctx.claims[0]!.knowledgeText).toBe("John killed Michael");
    expect(ctx.entityName).toBe(sarah.name);
  });
});

describe("checkContinuity (T7.3)", () => {
  it("detects a factual contradiction from the supersede flow (green -> blue eyes)", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const replacementId = randomUUID();
    const superseded = fact("Sarah", "eye color", "blue", randomUUID(), replacementId);
    const replacement = fact("Sarah", "eye color", "green", replacementId);
    const world: StoryWorld = {
      ...baseWorld(sarah, entity("Kaden", characterType.id), characterType),
      facts: [superseded, replacement],
    };
    const llm: LlmClient = createMockLlm();

    const reports = await checkContinuity(
      { store: storeWith(world), llm },
      STORY_ID,
      "contradictions",
    );
    expect(reports.some((report) => report.category === "contradictions" && report.severity === "critical")).toBe(true);
  });

  it("does NOT flag the same fact restated at higher confidence", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const replacementId = randomUUID();
    const earlier = fact("Sarah", "hair color", "red", randomUUID(), replacementId);
    const restated = fact("Sarah", "hair color", "red", replacementId);
    const world: StoryWorld = {
      ...baseWorld(sarah, entity("Kaden", characterType.id), characterType),
      facts: [earlier, restated],
    };
    const reports = await checkContinuity(
      { store: storeWith(world), llm: createMockLlm() },
      STORY_ID,
      "contradictions",
    );
    expect(reports.filter((report) => report.category === "contradictions")).toEqual([]);
  });

  it("detects a dangling thread introduced but never referenced again", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const world: StoryWorld = {
      ...baseWorld(sarah, entity("Kaden", characterType.id), characterType),
      scenes: [
        {
          id: randomUUID(),
          storyId: "test-story",
          title: "Chapter 1",
          settingId: null,
          when: { raw: "chapter 1", normalized: { chapter: "1", order: 1 } },
          summary: null,
          chapterNumber: 1,
          chapterId: null,
          position: 0,
          content: null,
          eventIds: [],
          participantIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      plotThreads: [thread("The photograph", "introduced", null)],
    };

    const reports = await checkContinuity(
      { store: storeWith(world), llm: createMockLlm() },
      STORY_ID,
      "dangling-threads",
    );
    expect(
      reports.some(
        (report) => report.category === "dangling-threads" && report.title.includes("The photograph"),
      ),
    ).toBe(true);
  });

  it("detects consequence-without-motivation events", async () => {
    const characterType = entityType("character", "characters", "character");
    const kaden = entity("Kaden", characterType.id);
    const world: StoryWorld = {
      ...baseWorld(entity("Sarah", characterType.id), kaden, characterType),
      events: [event("The mutiny", [kaden.id], ["Sarah loses her ship"])],
    };
    const reports = await checkContinuity(
      { store: storeWith(world), llm: createMockLlm() },
      STORY_ID,
      "motivation-gaps",
    );
    expect(
      reports.some(
        (report) => report.category === "motivation-gaps" && report.title.includes("The mutiny"),
      ),
    ).toBe(true);
  });

  it("merges the LLM's anachronism findings into the structural reports", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const world = baseWorld(sarah, entity("Kaden", characterType.id), characterType);

    const llmReports: ContinuityReport[] = [
      {
        category: "anachronisms",
        severity: "warning",
        title: "Pocket communicator before its invention",
        description: "A communicator appears in a chapter set before radios exist.",
        entityNames: ["Kaden"],
        evidence: ["chapter 2", "chapter 9"],
      },
    ];
    const llm: LlmClient = createMockLlm({
      fixtures: {
        "ANALYSIS TASK": llmReports as unknown as never,
      },
    });

    const reports = await checkContinuity(
      { store: storeWith(world), llm },
      STORY_ID,
      "all",
    );
    expect(
      reports.some((report) => report.category === "anachronisms" && report.title.includes("Pocket communicator")),
    ).toBe(true);
  });

  it("LLM failures degrade gracefully to the structural reports", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const replacementId = randomUUID();
    const superseded = fact("Sarah", "eye color", "blue", randomUUID(), replacementId);
    const replacement = fact("Sarah", "eye color", "green", replacementId);
    const world: StoryWorld = {
      ...baseWorld(sarah, entity("Kaden", characterType.id), characterType),
      facts: [superseded, replacement],
    };

    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue({ text: "x", usage: { inputTokens: 0, outputTokens: 1 } }),
      extractStructured: vi.fn().mockRejectedValue(new Error("provider down")),
    };

    const reports = await checkContinuity({ store: storeWith(world), llm }, STORY_ID, "all");
    expect(reports.some((report) => report.category === "contradictions")).toBe(true);
  });

  it("flags a superseded relationship whose kind changed", async () => {
    const characterType = entityType("character", "characters", "character");
    const sarah = entity("Sarah", characterType.id);
    const kaden = entity("Kaden", characterType.id);
    const replacementId = randomUUID();
    const world: StoryWorld = {
      ...baseWorld(sarah, kaden, characterType),
      relationships: [
        relationship(sarah.id, kaden.id, "friends", replacementId),
        { ...relationship(sarah.id, kaden.id, "rivals"), id: replacementId, supersededBy: null },
      ],
    };
    const reports = await checkContinuity(
      { store: storeWith(world), llm: createMockLlm() },
      STORY_ID,
      "relationship-state",
    );
    expect(
      reports.some(
        (report) =>
          report.category === "relationship-state" && report.title.includes("Sarah") && report.title.includes("Kaden"),
      ),
    ).toBe(true);
  });

  it("validates analysis types", () => {
    expect(isReportCategory("contradictions")).toBe(true);
    expect(isReportCategory("all")).toBe(false);
    expect(isReportCategory("not-a-category" as AnalysisType)).toBe(false);
  });
});