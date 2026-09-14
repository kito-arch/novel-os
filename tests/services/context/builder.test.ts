import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildContext,
  buildContextFromWorld,
  renderContextPackage,
  TOKEN_CAP,
} from "@/services/context/builder";
import {
  parseMentions,
  resolveMentions,
} from "@/services/context/mention-parser";
import type { AttributeValue, EntityType } from "@/domain/entity-types";
import type { Entity, StoryWorld } from "@/domain";
import type { StoryEvent } from "@/domain/events";
import type { EntityKnowledge } from "@/domain/knowledge";
import type { Fact } from "@/domain/provenance";
import type { Relationship } from "@/domain/relationships";
import { createMockStoryWorldStore } from "../../mocks";
import type { StoryWorldStore } from "@/container/story-world-store";
import type { Commit } from "@/domain/commits";

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();

function entityType(name: string, pluralName: string, baseKind: EntityType["baseKind"], attributeDefs: EntityType["attributeDefs"]): EntityType {
  return {
    id: randomUUID(),
    storyId: STORY_ID,
    name,
    pluralName,
    baseKind,
    description: null,
    attributeDefs,
    origin: "core",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function entity(name: string, entityTypeId: string, attributes: Record<string, AttributeValue> = {}, aliases: string[] = []): Entity {
  return {
    id: randomUUID(),
    storyId: STORY_ID,
    entityTypeId,
    name,
    aliases,
    attributes,
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function event(title: string, participantIds: string[]): StoryEvent {
  return {
    id: randomUUID(),
    title,
    description: `${title} happened`,
    settingId: null,
    when: { raw: "chapter 1", normalized: { chapter: "1", order: 1 } },
    motivation: null,
    consequences: [],
    knowledgeGained: [],
    knowledgeConcealed: [],
    participants: participantIds,
    involvedObjects: [],
    confidence: "inferred",
    provenance: { dictationId: DICTATION_ID, textChunk: "fixture", confidence: "inferred" },
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function knowledge(subjectEntityId: string, text: string, status: EntityKnowledge["status"]): EntityKnowledge {
  return {
    id: randomUUID(),
    subjectEntityId,
    factId: null,
    knowledgeText: text,
    status,
    learnedWhen: "chapter 1",
    learnedVia: "observation",
    createdAt: new Date("2026-01-03T00:00:00Z"),
  };
}

interface Seed {
  characters: EntityType;
  starship: EntityType;
  sarah: Entity;
  relentless: Entity;
  kaden: Entity;
  world: StoryWorld;
}

function buildBrandedWorld(): Seed {
  const characters = entityType("character", "characters", "character", [
    { key: "home", label: "Home", kind: "text", required: false, multi: false },
    { key: "age", label: "Age", kind: "number", required: false, multi: false },
  ]);
  const starship = entityType("starship", "starships", "physical", [
    { key: "class", label: "Class", kind: "text", required: false, multi: false },
    { key: "captain", label: "Captain", kind: "ref", required: false, multi: false, refType: "character" },
  ]);

  const sarah = entity("Sarah", characters.id, { home: "Crestfall", age: 29 }, ["Sar"]);
  const kaden = entity("Kaden", characters.id, { home: "Crestfall", age: 31 });
  const june = entity("June", characters.id, { home: "Hollow Harbor" });
  const orrin = entity("Orrin", characters.id, { home: "Crestfall" });
  const vespa = entity("Vespa", characters.id, { home: "Hollow Harbor" });
  const relentless = entity("The Relentless", starship.id, { class: "Interceptor", captain: "Kaden" }, ["Relentless"]);
  const stalwart = entity("Stalwart", starship.id, { class: "Cruiser" });

  const entities = [sarah, kaden, june, orrin, vespa, relentless, stalwart];

  const relationships: Relationship[] = [
    {
      id: randomUUID(),
      fromEntityId: relentless.id,
      toEntityId: kaden.id,
      kind: "commanded_by",
      details: null,
      confidence: "explicit",
      provenance: { dictationId: DICTATION_ID, textChunk: "", confidence: "explicit" },
      supersededBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: randomUUID(),
      fromEntityId: sarah.id,
      toEntityId: kaden.id,
      kind: "allied_with",
      details: "since chapter 1",
      confidence: "inferred",
      provenance: { dictationId: DICTATION_ID, textChunk: "", confidence: "inferred" },
      supersededBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];

  const events: StoryEvent[] = [
    event("Boarding the Relentless", [sarah.id, kaden.id]),
    event("Dock dispute", [june.id, vespa.id]),
  ];

  const knowledgeRows: EntityKnowledge[] = [
    knowledge(sarah.id, "Kaden commands the Relentless", "known"),
    knowledge(sarah.id, "Orrin defected", "unknown"),
  ];

  const facts: Fact[] = [
    {
      id: randomUUID(),
      subject: "The Relentless",
      predicate: "commanded by",
      objectValue: "Kaden",
      confidence: "explicit",
      provenance: { dictationId: DICTATION_ID, textChunk: "", confidence: "explicit" },
      supersededBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ];

  const world: StoryWorld = {
    id: STORY_ID,
    title: "Crestfall Rising",
    synopsis: null,
    storyType: null,
    revision: 4,
    entityTypes: [characters, starship],
    entities,
    facts,
    events,
    relationships,
    knowledge: knowledgeRows,
    scenes: [],
    plotThreads: [],
    openQuestions: [
      {
        id: randomUUID(),
        question: "Why did Orrin defect?",
        relatedEntityIds: [sarah.id, orrin.id],
        introducedInDictationId: DICTATION_ID,
        resolvedInDictationId: null,
        isResolved: false,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
  };

  return { characters, starship, sarah, relentless, kaden, world };
}

describe("parseMentions (T6.3)", () => {
  it("matches known names + aliases across all entity types, longest-match first", () => {
    const { world, sarah, relentless } = buildBrandedWorld();
    const mentions = parseMentions("Sarah walked onto the Relentless bridge.", world.entities);
    expect(mentions).toEqual([sarah.name, relentless.name]);
  });

  it("does not match inside a longer word", () => {
    const { world, sarah } = buildBrandedWorld();
    const others = world.entities.filter((entity) => entity.id !== sarah.id);
    expect(parseMentions("Sarahwin met the captain.", others)).toEqual([]);
  });

  it("handles aliases and deduplicates", () => {
    const { world, sarah } = buildBrandedWorld();
    const mentions = parseMentions("Sar saw the Relentless. Sar saluted.", world.entities);
    expect(mentions).toEqual([sarah.name, "The Relentless"]);
  });

  it("case-insensitive matching", () => {
    const { world, relentless } = buildBrandedWorld();
    expect(parseMentions("the RELENTLESS maneuvers", world.entities)).toEqual([relentless.name]);
  });
});

describe("resolveMentions", () => {
  it("resolves names and aliases, bounded to 10", () => {
    const { world } = buildBrandedWorld();
    const resolved = resolveMentions(["sarah", "relentless"], world.entities);
    expect(resolved.map((match) => match.name)).toEqual(["Sarah", "The Relentless"]);
  });

  it("ignores unknown mentions and deduplicates by entity", () => {
    const { world, sarah } = buildBrandedWorld();
    const resolved = resolveMentions(["nobody", "sarah", "sarah"], world.entities);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.name).toBe(sarah.name);
  });
});

describe("buildContext (T6.1)", () => {
  it("includes only mentioned entities with declared attributes, plus their relations", async () => {
    const { world, sarah, relentless, kaden } = buildBrandedWorld();

    const store: StoryWorldStore = {
      ...createMockStoryWorldStore(),
      getWorld: async () => world,
    };
    const pkg = await buildContext(store, STORY_ID, ["Sarah", "The Relentless"]);

    const names = pkg.entities.map((entity) => entity.name).sort();
    expect(names).toEqual([sarah.name, relentless.name].sort());

    const sarahItem = pkg.entities.find((entity) => entity.name === sarah.name)!;
    expect(sarahItem.attributes.map((value) => value.key)).toEqual(["home", "age"]);
    expect(sarahItem.typeName).toBe("character");

    const typeNames = pkg.entities.map((entity) => entity.typeName).sort();
    expect(typeNames).toEqual(["character", "starship"]);

    // Relations: relentless→Kaden (commanded_by) and Sarah→Kaden (allied_with).
    expect(pkg.relationships.some((r) => r.kind === "commanded_by" && r.fromEntityName === relentless.name)).toBe(true);
    expect(pkg.relationships.some((r) => r.kind === "allied_with" && r.fromEntityName === sarah.name)).toBe(true);

    // Only events touching a matched entity appear; the dock dispute does not.
    expect(pkg.events.map((value) => value.title)).toEqual(["Boarding the Relentless"]);
    expect(pkg.events[0]!.participants).toContain(sarah.name);
    expect(pkg.events[0]!.participants).toContain(kaden.name);

    expect(pkg.knowledge.some((row) => row.knowledgeText === "Kaden commands the Relentless")).toBe(true);

    expect(pkg.openQuestions.some((question) => question.question.includes("Orrin defect"))).toBe(true);
    expect(pkg.openQuestions[0]!.relatedEntityNames).toContain(sarah.name);

    expect(pkg.facts.some((fact) => fact.includes("The Relentless commanded by \"Kaden\""))).toBe(true);
    expect(pkg.tokenEstimate).toBeGreaterThan(0);
  });

  it("renders a deterministic, bounded prompt block", () => {
    const { world } = buildBrandedWorld();
    const pkg = buildContextFromWorld(world, ["Sarah"]);
    const rendered = renderContextPackageOf(pkg);
    expect(rendered).toContain('STORY: "Crestfall Rising"');
    expect(rendered).toContain("## Sarah — character");
  });

  it("token cap stays under 4k (T6.2 cost guard)", () => {
    const { world } = buildBrandedWorld();
    // Bloat: many entities, long attribute values, many relations/events/knowledge.
    const longText = "x".repeat(8_000);
    const type = world.entityTypes[0]!;
    const extraEntities = Array.from({ length: 60 }, (_, index) =>
      entity(`Character ${index}`, type.id, { home: longText }),
    );
    const corpus: StoryWorld = {
      ...world,
      entities: [...world.entities, ...extraEntities],
      events: Array.from({ length: 80 }, (_, index) => event(`Event ${index}`, [world.entities[0]!.id])),
      knowledge: Array.from({ length: 40 }, (_, index) =>
        knowledge(world.entities[0]!.id, `Claim ${index}: ${longText}, repeated text`, "known"),
      ),
    };

    const pkg = buildContextFromWorld(corpus, ["Sarah", "Character 7"]);
    expect(pkg.tokenEstimate).toBeLessThan(TOKEN_CAP);
  });

  it("propagates the world through the store-backed overload", async () => {
    const store = createMockStoryWorldStore();
    const { world } = buildBrandedWorld();
    await store.commit(bareCommit(world));

    const pkg = await buildContext(store, STORY_ID, ["Sarah"]);
    expect(pkg.storyId).toBe(STORY_ID);
    expect(pkg.entities.map((entity) => entity.name)).toEqual([world.entities[0]!.name]);
    expect(pkg.tokenEstimate).toBeGreaterThan(0);
  });
});

function renderContextPackageOf(pkg: ReturnType<typeof buildContextFromWorld>): string {
  return renderContextPackage(pkg);
}

function bareCommit(world: StoryWorld): Commit {
  return {
    storyId: world.id,
    appliedFromRevision: 0,
    newEntityTypes: world.entityTypes,
    entities: world.entities,
    entityUpdates: [],
    events: world.events,
    facts: world.facts,
    relationships: world.relationships,
    knowledge: world.knowledge,
    scenes: world.scenes,
    plotThreads: world.plotThreads,
    openQuestions: world.openQuestions,
    resolvedOpenQuestionIds: [],
    contradictions: [],
    supersedeFactIds: [],
  };
}