import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildContextFromWorld,
  renderContextPackage,
  countWords,
  TOKEN_CAP,
  MAX_MENTION_MATCHES,
} from "@/services/context/builder";
import type { StoryWorld } from "@/domain/story-world";
import type { Entity, EntityType } from "@/domain";
import type { Fact } from "@/domain/provenance";
import type { Relationship } from "@/domain/relationships";

// T14.3 — Cost guard: even with a maximally dense world (many entities,
// relationships, facts) the token estimate from buildContextFromWorld must
// stay under TOKEN_CAP (4 000) because every list in the builder is hard-capped.

const STORY_ID = randomUUID();
const DICTATION_ID = randomUUID();

const WORD_POOL = [
  "starship", "captain", "Admiral", "station", "empire", "faction",
  "battle", "treaty", "commander", "navigator", "engineer", "pilot",
  "rebellion", "alliance", "planet", "sector", "fleet", "mission",
];

function word(i: number): string {
  return WORD_POOL[i % WORD_POOL.length] + i;
}

function buildLargeWorld(): StoryWorld {
  const characterType: EntityType = {
    id: randomUUID(),
    storyId: STORY_ID,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: null,
    attributeDefs: [
      { key: "bio", label: "Bio", kind: "text", required: false, multi: false },
      { key: "rank", label: "Rank", kind: "text", required: false, multi: false },
    ],
    origin: "core",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  // 100 entities — well above MAX_MENTION_MATCHES (10), so truncation kicks in
  const entities: Entity[] = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    storyId: STORY_ID,
    entityTypeId: characterType.id,
    name: `Entity${i}`,
    aliases: [`Alias${i}A`, `Alias${i}B`],
    attributes: {
      bio: "x".repeat(500), // long attribute → gets truncated by MAX_ATTRIBUTE_VALUE_CHARS
      rank: word(i),
    },
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }));

  // 200 facts — far above any rendered cap
  const facts: Fact[] = Array.from({ length: 200 }, (_, i) => ({
    id: randomUUID(),
    subject: `Entity${i % 100}`,
    predicate: `predicate_${i}`,
    objectValue: `value_${i}_${"y".repeat(100)}`,
    confidence: i % 2 === 0 ? "explicit" : "implied",
    provenance: { dictationId: DICTATION_ID, textChunk: "seed", confidence: "explicit" },
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }));

  // 100 relationships — above MAX_RELATIONSHIPS (40)
  const relationships: Relationship[] = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    fromEntityId: entities[i % 50].id,
    toEntityId: entities[(i + 1) % 50].id,
    kind: `rel_${i}`,
    details: "detail ".repeat(20),
    confidence: "explicit",
    provenance: { dictationId: DICTATION_ID, textChunk: "seed", confidence: "explicit" },
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }));

  return {
    id: STORY_ID,
    title: "The Long War Chronicles",
    synopsis: null,
    storyType: null,
    revision: 42,
    entityTypes: [characterType],
    entities,
    facts,
    relationships,
    events: [],
    knowledge: [],
    openQuestions: [],
    plotThreads: [],
    scenes: [],
  };
}

describe("cost guard (T14.3)", () => {
  it("token estimate stays under TOKEN_CAP across 100 random mention sets on a dense world", () => {
    const world = buildLargeWorld();
    const entityNames = world.entities.map((e) => e.name);

    let totalTokens = 0;
    const RUNS = 100;

    for (let i = 0; i < RUNS; i++) {
      // Pick up to MAX_MENTION_MATCHES + a few extra random names to stress the resolution path
      const start = i % entityNames.length;
      const mentions = entityNames.slice(start, start + MAX_MENTION_MATCHES + 3);
      const pkg = buildContextFromWorld(world, mentions);
      totalTokens += pkg.tokenEstimate;
      // Each individual run must also stay bounded
      expect(pkg.tokenEstimate).toBeLessThanOrEqual(TOKEN_CAP);
    }

    const average = totalTokens / RUNS;
    expect(average).toBeLessThanOrEqual(TOKEN_CAP);
  });

  it("empty mention list produces a minimal context still under cap", () => {
    const world = buildLargeWorld();
    const pkg = buildContextFromWorld(world, []);
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(TOKEN_CAP);
    // Minimal render: just the story header
    const rendered = renderContextPackage(pkg);
    expect(countWords(rendered)).toBeGreaterThan(0);
  });

  it("single mention resolves at most MAX_MENTION_MATCHES entities", () => {
    const world = buildLargeWorld();
    const pkg = buildContextFromWorld(world, ["Entity0"]);
    expect(pkg.entities.length).toBeLessThanOrEqual(MAX_MENTION_MATCHES);
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(TOKEN_CAP);
  });

  it("long attribute values are truncated so they do not inflate the token estimate", () => {
    const pkg = buildContextFromWorld(buildLargeWorld(), ["Entity0"]);
    const rendered = renderContextPackage(pkg);
    // The 500-char bio must be truncated — rendered line should not contain 500 'x' chars
    expect(rendered).not.toContain("x".repeat(300));
    expect(pkg.tokenEstimate).toBeLessThanOrEqual(TOKEN_CAP);
  });
});
