import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  EntityTypeSchema,
  SupersedeAction,
  activeFacts,
  applyCommit,
  coreEntityTypes,
  emptyCommit,
  spaceOperaPreset,
  type Commit,
  type EntityType,
  type Fact,
  type StoryWorld,
} from "@/domain";

const STORY_ID = "30000000-0000-4000-8000-000000000001";
const DICTATION_ID = "90000000-0000-4000-8000-000000000001";
const CHAR_ID = "40000000-0000-4000-8000-000000000001";
const OASIS_ID = "40000000-0000-4000-8000-000000000003";
const RELENTLESS_ID = "40000000-0000-4000-8000-000000000002";
const T0 = new Date("2026-02-01T00:00:00.000Z");

function characterType(world: StoryWorld): EntityType {
  return world.entityTypes.find((type) => type.name === "character")!;
}

function planetType(world: StoryWorld): EntityType {
  return world.entityTypes.find((type) => type.name === "place")!;
}

function buildWorld(includePreset = false): StoryWorld {
  const entityTypes = includePreset
    ? [...coreEntityTypes, ...spaceOperaPreset.entityTypes]
    : [...coreEntityTypes];
  const character = characterType({ entityTypes } as StoryWorld);
  const planet = planetType({ entityTypes } as StoryWorld);

  return {
    id: STORY_ID,
    title: "The Relentless",
    synopsis: null,
    storyType: includePreset ? "space-opera" : null,
    revision: 0,
    entityTypes,
    entities: [
      {
        id: CHAR_ID,
        storyId: STORY_ID,
        entityTypeId: character.id,
        name: "Aria Voss",
        aliases: [],
        attributes: { goals: ["find the relic"] },
        media: [],
        createdAt: T0,
      },
      {
        id: OASIS_ID,
        storyId: STORY_ID,
        entityTypeId: planet.id,
        name: "The Oasis Moon",
        aliases: [],
        attributes: { climate: "temperate" },
        media: [],
        createdAt: T0,
      },
    ],
    facts: [],
    events: [],
    relationships: [],
    knowledge: [],
    scenes: [],
    plotThreads: [],
    openQuestions: [],
  };
}

const starshipType: EntityType = EntityTypeSchema.parse({
  id: "00000000-0000-4000-8000-000000000021",
  storyId: STORY_ID,
  name: "starship",
  pluralName: "starships",
  baseKind: "physical",
  description: null,
  attributeDefs: [
    { key: "class", label: "Class", kind: "enum", enumValues: ["Falcon", "Battlestar"] },
    { key: "captain", label: "Captain", kind: "ref", refType: "character" },
  ],
  origin: "extracted",
  supersededBy: null,
  createdAt: T0,
});

const FACT_ID = "80000000-0000-4000-8000-000000000001";

function buildStarshipCommit(revision = 0): Commit {
  return {
    storyId: STORY_ID,
    appliedFromRevision: revision,
    newEntityTypes: [starshipType],
    entities: [
      {
        id: RELENTLESS_ID,
        storyId: STORY_ID,
        entityTypeId: starshipType.id,
        name: "The Relentless",
        aliases: [],
        attributes: { class: "Falcon", captain: "Aria Voss" },
        media: [],
        createdAt: T0,
      },
      {
        id: "40000000-0000-4000-8000-000000000004",
        storyId: STORY_ID,
        entityTypeId: starshipType.id,
        name: "Dauntless",
        aliases: [],
        attributes: { class: "Battlestar" },
        media: [],
        createdAt: T0,
      },
    ],
    entityUpdates: [],
    events: [
      {
        id: "40000000-0000-4000-8000-000000000005",
        title: "The Relentless and her adversary trade fire",
        description: null,
        settingId: OASIS_ID,
        when: null,
        motivation: null,
        consequences: [],
        knowledgeGained: [],
        knowledgeConcealed: [],
        participants: [RELENTLESS_ID],
        involvedObjects: [],
        confidence: "explicit",
        provenance: { dictationId: DICTATION_ID, textChunk: "trade fire", confidence: "explicit" },
        createdAt: T0,
      },
    ],
    facts: [
      {
        id: FACT_ID,
        subject: "The Relentless",
        predicate: "has captain",
        objectValue: "Aria Voss",
        confidence: "explicit",
        provenance: { dictationId: DICTATION_ID, textChunk: "has a captain", confidence: "explicit" },
        supersededBy: null,
        createdAt: T0,
      },
    ],
    relationships: [],
    knowledge: [],
    scenes: [],
    plotThreads: [],
    openQuestions: [
      {
        id: "40000000-0000-4000-8000-000000000006",
        question: "Who fired first?",
        relatedEntityIds: [],
        introducedInDictationId: DICTATION_ID,
        resolvedInDictationId: null,
        isResolved: false,
        createdAt: T0,
      },
    ],
    contradictions: [
      {
        existingFactId: null,
        existingFactDescription: "The Relentless has no captain",
        newFactDescription: "Aria Voss commands the Relentless",
        action: SupersedeAction.FlagSoft,
      },
    ],
    resolvedOpenQuestionIds: [],
    supersedeFactIds: [],
  };
}

describe("applyCommit", () => {
  it("registers a new entity type, adds entities, appends content and bumps the revision", () => {
    const world = buildWorld();
    const { world: next, result } = applyCommit(world, buildStarshipCommit());

    expect(result.revision).toBe(1);
    expect(next.revision).toBe(1);

    expect(result.entityTypesCreated).toBe(1);
    expect(result.entitiesCreatedByType).toEqual({ starship: 2 });
    expect(result.eventsAdded).toBe(1);
    expect(result.factsAdded).toBe(1);
    expect(result.contradictionsFound).toBe(1);
    expect(result.openQuestionsAdded).toBe(1);

    const starship = next.entityTypes.find((type) => type.name === "starship")!;
    expect(starship.baseKind).toBe("physical");

    const relentless = next.entities.find((entity) => entity.name === "The Relentless")!;
    expect(relentless.entityTypeId).toBe(starshipType.id);
    expect(relentless.attributes.class).toBe("Falcon");

    expect(next.events[0].settingId).toBe(OASIS_ID);
    expect(next.events[0].participants).toContain(RELENTLESS_ID);
    expect(next.facts[0].confidence).toBe("explicit");
    expect(next.openQuestions[0].question).toBe("Who fired first?");

    expect(next.entityTypes.find((type) => type.name === "character")).toBeDefined();
    expect(next.entityTypes.find((type) => type.name === "place")).toBeDefined();
    expect(next.entities.find((entity) => entity.name === "Aria Voss")).toBeDefined();
  });

  it("marks staged open questions resolved (stage_resolve_open_question)", () => {
    const unanswered = {
      id: "40000000-0000-4000-8000-000000000006",
      question: "Who fired first?",
      relatedEntityIds: [] as string[],
      introducedInDictationId: DICTATION_ID,
      resolvedInDictationId: null,
      isResolved: false,
      createdAt: T0,
    };
    const world: StoryWorld = { ...buildWorld(), openQuestions: [unanswered] };
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      resolvedOpenQuestionIds: [unanswered.id],
    };

    const { world: next, result } = applyCommit(world, commit);

    expect(result.openQuestionsResolved).toBe(1);
    expect(next.openQuestions[0].isResolved).toBe(true);
  });

  it("rejects resolution of an unknown or already-resolved open question", () => {
    const resolved = {
      id: "40000000-0000-4000-8000-000000000006",
      question: "Who fired first?",
      relatedEntityIds: [] as string[],
      introducedInDictationId: DICTATION_ID,
      resolvedInDictationId: null,
      isResolved: true,
      createdAt: T0,
    };
    const world: StoryWorld = { ...buildWorld(), openQuestions: [resolved] };
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      resolvedOpenQuestionIds: [resolved.id],
    };

    expect(() => applyCommit(world, commit)).toThrow(/already resolved/);
    const orphan: Commit = { ...emptyCommit(STORY_ID, 0), resolvedOpenQuestionIds: [randomUUID()] };
    expect(() => applyCommit(buildWorld(), orphan)).toThrow(/unknown open question/);
  });

  it("survives on a space-opera world seeded via the preset", () => {
    const world = buildWorld(true);
    const weaponType = EntityTypeSchema.parse({
      id: "00000000-0000-4000-8000-000000000031",
      storyId: STORY_ID,
      name: "weapon",
      pluralName: "weapons",
      baseKind: "physical",
      description: null,
      attributeDefs: [{ key: "yield", label: "Yield", kind: "text" }],
      origin: "extracted",
      supersededBy: null,
      createdAt: T0,
    });
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      newEntityTypes: [weaponType],
      entities: [
        {
          id: "40000000-0000-4000-8000-000000000007",
          storyId: STORY_ID,
          entityTypeId: weaponType.id,
          name: "Turbo Laser",
          aliases: [],
          attributes: { yield: "heavy" },
          media: [],
          createdAt: T0,
        },
      ],
    };

    const { world: next, result } = applyCommit(world, commit);

    expect(result.revision).toBe(1);
    expect(next.entityTypes.find((type) => type.name === "weapon")?.baseKind).toBe("physical");
    expect(next.entityTypes.find((type) => type.name === "starship")).toBeDefined();
    expect(next.entityTypes.find((type) => type.name === "faction")).toBeDefined();
    expect(next.entities.find((entity) => entity.name === "Aria Voss")).toBeDefined();
  });

  it("applies an empty commit without changing any content", () => {
    const world = buildWorld();
    const { world: next, result } = applyCommit(world, { ...emptyCommit(STORY_ID, 0) });

    expect(result.revision).toBe(1);
    expect(result.entitiesCreatedByType).toEqual({});
    expect(next.entities).toHaveLength(world.entities.length);
    expect(next.entityTypes).toHaveLength(world.entityTypes.length);
    expect(next.facts).toEqual([]);
    expect(next.events).toEqual([]);
  });

  it("applies a supersede-only commit that marks an existing fact superseded", () => {
    const world = buildWorld();
    const fact: Fact = {
      id: FACT_ID,
      subject: "The Relentless",
      predicate: "is crippled",
      objectValue: null,
      confidence: "explicit",
      provenance: { dictationId: DICTATION_ID, textChunk: "crippled", confidence: "explicit" },
      supersededBy: null,
      createdAt: T0,
    };
    const worldWithFact: StoryWorld = { ...world, facts: [fact] };

    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      supersedeFactIds: [FACT_ID],
    };

    const { world: next, result } = applyCommit(worldWithFact, commit);

    expect(result.factsSuperseded).toBe(1);
    expect(next.facts[0].supersededBy).not.toBeNull();
    expect(activeFacts(next)).toHaveLength(0);
  });

  it("points an old fact's supersededBy at the new fact that replaces it", () => {
    const world = buildWorld();
    const oldRecord: Fact = {
      id: FACT_ID,
      subject: "The Relentless",
      predicate: "is crippled",
      objectValue: null,
      confidence: "explicit",
      provenance: { dictationId: DICTATION_ID, textChunk: "crippled", confidence: "explicit" },
      supersededBy: null,
      createdAt: T0,
    };
    const worldWithFact: StoryWorld = { ...world, facts: [oldRecord] };

    const replacementId = "80000000-0000-4000-8000-000000000002";
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      facts: [
        {
          id: replacementId,
          subject: "The Relentless",
          predicate: "is operational",
          objectValue: null,
          confidence: "explicit",
          provenance: { dictationId: DICTATION_ID, textChunk: "operational", confidence: "explicit" },
          supersededBy: null,
          createdAt: T0,
        },
      ],
      contradictions: [
        {
          existingFactId: FACT_ID,
          existingFactDescription: "The Relentless is crippled",
          newFactDescription: "The Relentless is operational",
          action: SupersedeAction.Supersede,
        },
      ],
    };

    const { world: next } = applyCommit(worldWithFact, commit);

    expect(next.facts.find((fact) => fact.id === FACT_ID)!.supersededBy).toBe(replacementId);
  });

  it("rejects a commit that attaches media to an abstract-base entity", () => {
    const world = buildWorld(true);
    const faction = world.entityTypes.find((type) => type.name === "faction")!;
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      entities: [
        {
          id: "40000000-0000-4000-8000-000000000008",
          storyId: STORY_ID,
          entityTypeId: faction.id,
          name: "The Galactic Concord",
          aliases: [],
          attributes: {},
          media: [
            {
              id: "a0000000-0000-4000-8000-000000000009",
              url: "https://example.com/flag.png",
              role: "gallery",
              caption: null,
              createdAt: T0,
            },
          ],
          createdAt: T0,
        },
      ],
    };

    expect(() => applyCommit(world, commit)).toThrow(/media/);
  });

  it("rejects commits based on a stale revision", () => {
    const world = buildWorld();
    expect(() => applyCommit(world, buildStarshipCommit(1))).toThrow(/revision/);
  });

  it("rejects an entity that references an unknown entity type", () => {
    const world = buildWorld();
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      entities: [
        {
          id: "40000000-0000-4000-8000-000000000009",
          storyId: STORY_ID,
          entityTypeId: "00000000-0000-4000-8000-00000000ffff",
          name: "Ghost",
          aliases: [],
          attributes: {},
          media: [],
          createdAt: T0,
        },
      ],
    };

    expect(() => applyCommit(world, commit)).toThrow(/unknown entity type/);
  });

  it("rejects an entity whose id already exists in the world", () => {
    const world = buildWorld();
    const commit: Commit = {
      ...emptyCommit(STORY_ID, 0),
      entities: [
        {
          id: CHAR_ID,
          storyId: STORY_ID,
          entityTypeId: characterType(world).id,
          name: "Aria Voss 2",
          aliases: [],
          attributes: {},
          media: [],
          createdAt: T0,
        },
      ],
    };

    expect(() => applyCommit(world, commit)).toThrow(/already exists/);
  });
});