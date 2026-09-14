import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StoryWorldStore } from "@/container";
import type { Commit } from "@/domain/commits";
import type { StoryEvent } from "@/domain/events";
import type { EntityKnowledge } from "@/domain/knowledge";
import type { StoryWorld } from "@/domain/story-world";

// Reusable contract suite for any StoryWorldStore implementation (memory,
// Postgres in T8.2, …). A conforming store must satisfy these behaviors so
// services/test code can treat every adapter as interchangeable.
//
// Usage: `runStoryWorldStoreContract(() => createMockStoryWorldStore())`
// inside a test file.
export function runStoryWorldStoreContract(factory: () => StoryWorldStore): void {
  const storyId = randomUUID();
  const shipTypeId = randomUUID();
  const dates = {
    t0: new Date("2026-01-01T00:00:00Z"),
    t1: new Date("2026-02-01T00:00:00Z"),
    t2: new Date("2026-03-01T00:00:00Z"),
  };

  const shipType = {
    id: shipTypeId,
    storyId,
    name: "starship",
    pluralName: "starships",
    baseKind: "physical" as const,
    description: null,
    attributeDefs: [
      { key: "class", label: "Class", kind: "text" as const, required: true, multi: false },
    ],
    origin: "extracted" as const,
    supersededBy: null,
    createdAt: dates.t0,
  };

  const relentless: Parameters<StoryWorldStore["commit"]>[0]["entities"][number] = {
    id: randomUUID(),
    storyId,
    entityTypeId: shipTypeId,
    name: "The Relentless",
    aliases: ["Relentless"],
    attributes: { class: "Falcon-class" },
    media: [],
    createdAt: dates.t0,
  };

  const secondShip: Parameters<StoryWorldStore["commit"]>[0]["entities"][number] = {
    id: randomUUID(),
    storyId,
    entityTypeId: shipTypeId,
    name: "The Manticore",
    aliases: [],
    attributes: { class: "Falcon-class" },
    media: [],
    createdAt: dates.t1,
  };

  function commit(overrides: Partial<Commit> = {}): Commit {
    return {
      storyId,
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

  function event(id: string, settingId: string, participants: string[] = [], at: Date): StoryEvent {
    return {
      id,
      title: "A chase",
      description: null,
      settingId,
      when: null,
      motivation: null,
      consequences: [],
      knowledgeGained: [],
      knowledgeConcealed: [],
      participants,
      involvedObjects: [],
      confidence: "explicit",
      provenance: { dictationId: randomUUID(), textChunk: "they chased", confidence: "explicit" },
      createdAt: at,
    };
  }

  describe("contract: StoryWorldStore", () => {
    it("returns null for an unknown story", async () => {
      const store = factory();
      expect(await store.getWorld(storyId)).toBeNull();
      expect(await store.getEntity(storyId, randomUUID())).toBeNull();
      expect(await store.byRevision(storyId, 0)).toBeNull();
      expect(await store.queryEvents(storyId)).toEqual([]);
    });

    it("commits a type + entity registration and reads it back", async () => {
      const store = factory();
      const result = await store.commit(
        commit({ newEntityTypes: [shipType], entities: [relentless] }),
      );
      expect(result.entityTypesCreated).toBe(1);
      expect(result.entitiesCreated).toBe(1);
      expect(result.entitiesCreatedByType).toEqual({ starship: 1 });
      expect(result.revision).toBe(1);

      const world = await store.getWorld(storyId);
      expect(world?.entityTypes.map((t) => t.name)).toContain("starship");
      expect(world?.entities.map((e) => e.name)).toEqual(["The Relentless"]);

      const byName = await store.findEntityByName(storyId, "relentless");
      expect(byName?.id).toBe(relentless.id);
      const viaAlias = await store.findEntityByName(storyId, "Relentless");
      expect(viaAlias?.id).toBe(relentless.id);
      const byId = await store.getEntity(storyId, relentless.id);
      expect(byId?.attributes).toEqual({ class: "Falcon-class" });
    });

    it("enforces the appliedFromRevision guard and commits are atomic", async () => {
      const store = factory();

      await expect(
        store.commit(commit({ entities: [{ ...relentless, entityTypeId: randomUUID() }] })),
      ).rejects.toThrow(/unknown entity type/);

      // A failed commit must not mutate the world or bump the revision.
      const world = await store.getWorld(storyId);
      expect(world).toBeNull();

      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless] }));
      await expect(
        store.commit({ ...commit(), appliedFromRevision: 7 }),
      ).rejects.toThrow(/revision mismatch/);
    });

    it("appends events and filters queryEvents by setting/participant/date", async () => {
      const store = factory();
      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless, secondShip] }));

      const e1 = event(randomUUID(), secondShip.id, [relentless.id], dates.t1);
      const e2 = event(randomUUID(), relentless.id, [], dates.t2);
      await store.commit(
        commit({ appliedFromRevision: 1, events: [e1, e2] }),
      );

      expect(await store.queryEvents(storyId)).toHaveLength(2);
      expect((await store.queryEvents(storyId, { settingId: secondShip.id })).map((e) => e.id)).toEqual([e1.id]);
      expect((await store.queryEvents(storyId, { entityId: relentless.id })).map((e) => e.id)).toEqual([e1.id, e2.id]);
      const ranged = await store.queryEvents(storyId, { from: dates.t2, limit: 10 });
      expect(ranged.map((e) => e.id)).toEqual([e2.id]);
      const beforeAll = await store.queryEvents(storyId, { to: dates.t0 });
      expect(beforeAll).toEqual([]);
    });

    it("reconstructs immutable per-revision snapshots via byRevision", async () => {
      const store = factory();
      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless] }));
      await store.commit(
        commit({ appliedFromRevision: 1, entities: [secondShip] }),
      );

      const rev1 = await store.byRevision(storyId, 1);
      const world = await store.getWorld(storyId);
      expect(rev1?.entities.map((e) => e.name)).toEqual(["The Relentless"]);
      expect(world?.entities.map((e) => e.name)).toEqual(["The Relentless", "The Manticore"]);
      expect(rev1).not.toBe(world);
      expect(rev1?.revision).toBe(1);
    });

    it("supersedes facts and rejects unknown supersede targets", async () => {
      const store = factory();
      const factId = randomUUID();
      await store.commit(
        commit({
          facts: [
            {
              id: factId,
              subject: "The Relentless",
              predicate: "is_captained_by",
              objectValue: "Sarah",
              confidence: "explicit",
              provenance: {
                dictationId: randomUUID(),
                textChunk: "Sarah captains",
                confidence: "explicit",
              },
              supersededBy: null,
              createdAt: dates.t0,
            },
          ],
        }),
      );

      const supersede = await store.commit(
        commit({ appliedFromRevision: 1, supersedeFactIds: [factId] }),
      );
      expect(supersede.factsSuperseded).toBe(1);
      expect((await store.getWorld(storyId))?.facts[0].supersededBy).not.toBeNull();

      await expect(
        store.commit(commit({ appliedFromRevision: 2, supersedeFactIds: [randomUUID()] })),
      ).rejects.toThrow(/cannot supersede unknown fact/);
    });

    it("supports the entity-type registry without touching the world revision", async () => {
      const store = factory();
      const id = await store.upsertEntityType(storyId, {
        storyId,
        name: "planet",
        pluralName: "planets",
        baseKind: "place",
        description: null,
        attributeDefs: [],
        origin: "core",
        supersededBy: null,
      });

      const sameId = await store.upsertEntityType(storyId, {
        storyId,
        name: "Planet",
        pluralName: "planets",
        baseKind: "place",
        description: "updated",
        attributeDefs: [],
        origin: "core",
        supersededBy: null,
      });
      expect(sameId).toBe(id);
      expect((await store.findEntityTypeByName(storyId, "PLANET"))?.description).toBe("updated");
      expect((await store.findEntityTypeByName(storyId, "nope"))).toBeNull();

      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless] }));
      expect((await store.getEntityTypes(storyId)).length).toBeGreaterThanOrEqual(2);
      expect((await store.listEntities(storyId, shipTypeId)).map((e) => e.name)).toEqual([
        "The Relentless",
      ]);
      expect((await store.listEntities(storyId)).length).toBeGreaterThan(0);
    });

    it("attaches media and inserts knowledge", async () => {
      const store = factory();
      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless] }));

      const mediaId = await store.attachMedia(relentless.id, {
        url: "s3://bucket/relentless.jpg",
        role: "portrait",
        caption: "The Relentless in drydock",
      });
      expect(mediaId).toBeTruthy();
      const media = await store.getMedia(relentless.id);
      expect(media[0].url).toBe("s3://bucket/relentless.jpg");
      expect((await store.getWorld(storyId))?.entities[0].media).toHaveLength(1);

      const knowledgeId = await store.insertKnowledge(storyId, {
        subjectEntityId: relentless.id,
        factId: null,
        knowledgeText: "The Relentless knows the jump coordinates.",
        status: "known",
        learnedWhen: null,
        learnedVia: "extraction",
      });
      expect(knowledgeId).toBeTruthy();
      expect((await store.getKnowledge(storyId, relentless.id))[0].knowledgeText).toContain("coordinates");
      const world = await store.getWorld(storyId);
      expect((world?.knowledge ?? []).some((k: EntityKnowledge) => k.id === knowledgeId)).toBe(true);
    });

    it("keeps snapshots untouched by later auxiliary writes", async () => {
      const store = factory();
      await store.commit(commit({ newEntityTypes: [shipType], entities: [relentless] }));
      const world: StoryWorld | null = await store.byRevision(storyId, 1);
      await store.attachMedia(relentless.id, { url: "s3://bucket/pic.jpg", role: "gallery", caption: null });
      const current = await store.getWorld(storyId);
      expect((current?.entities[0].media ?? []).length).toBe(1);
      expect((world?.entities[0].media ?? []).length).toBe(0);
    });
  });
}