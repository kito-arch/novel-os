import { randomUUID } from "node:crypto";
import type { Clock } from "@/container/clock";
import type {
  EventQuery,
  StoryWorldStore,
} from "@/container/story-world-store";
import type { Chapter } from "@/domain/chapters";
import type { Commit, CommitResult } from "@/domain/commits";
import { applyCommit } from "@/domain/commits";
import type { Entity, MediaRef } from "@/domain/entities";
import type { EntityType } from "@/domain/entity-types";
import type { StoryEvent } from "@/domain/events";
import type { EntityKnowledge } from "@/domain/knowledge";
import type { Scene } from "@/domain/scenes";
import type { StoryMeta, StoryWorld } from "@/domain/story-world";

function identity(): string {
  return randomUUID();
}

export interface MockStoryWorldStoreOptions {
  clock?: Clock;
  now?: () => Date;
}

export class MockStoryWorldStore implements StoryWorldStore {
  private readonly worlds = new Map<string, StoryWorld>();
  private readonly revisions = new Map<string, Map<number, StoryWorld>>();
  private readonly mediaByEntity = new Map<string, MediaRef[]>();
  private readonly knowledgeBySubject = new Map<string, EntityKnowledge[]>();
  private readonly chaptersStore = new Map<string, Chapter[]>();
  private readonly proseScenesStore = new Map<string, Scene[]>();
  private readonly ownedStories = new Map<string, StoryMeta[]>();

  constructor(private readonly options: MockStoryWorldStoreOptions = {}) {}

  private now(): Date {
    return this.options.clock?.now() ?? this.options.now?.() ?? new Date();
  }

  private createWorld(storyId: string): StoryWorld {
    return {
      id: storyId,
      title: "Untitled story",
      synopsis: null,
      storyType: null,
      revision: 0,
      entityTypes: [],
      entities: [],
      facts: [],
      events: [],
      relationships: [],
      knowledge: [],
      scenes: [],
      plotThreads: [],
      openQuestions: [],
    };
  }

  private recordSnapshot(storyId: string, world: StoryWorld): void {
    let byRevision = this.revisions.get(storyId);
    if (!byRevision) {
      byRevision = new Map();
      this.revisions.set(storyId, byRevision);
    }
    byRevision.set(world.revision, world);
  }

  private mergeKnowledge(
    committed: EntityKnowledge[],
    subjectsById: ReadonlyMap<string, EntityKnowledge[]>,
  ): EntityKnowledge[] {
    const byId = new Map<string, EntityKnowledge>();
    for (const row of committed) byId.set(row.id, row);
    for (const rows of subjectsById.values()) {
      for (const row of rows) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  private finalize(world: StoryWorld): StoryWorld {
    const entities = world.entities.map((entity) => {
      const media = this.mediaByEntity.get(entity.id);
      return media?.length ? { ...entity, media } : entity;
    });
    const knowledge = this.mergeKnowledge(world.knowledge, this.knowledgeBySubject);
    return { ...world, entities, knowledge };
  }

  async listStories(ownerId: string): Promise<StoryMeta[]> {
    return (this.ownedStories.get(ownerId) ?? []).slice().reverse();
  }

  async createStory(id: string, data: { title: string; ownerId: string }): Promise<void> {
    const existing = this.ownedStories.get(data.ownerId) ?? [];
    if (existing.some((s) => s.id === id)) return;
    const meta: StoryMeta = { id, title: data.title, createdAt: this.now() };
    this.ownedStories.set(data.ownerId, [...existing, meta]);
    this.worlds.set(id, { ...this.createWorld(id), title: data.title });
  }

  async getWorld(storyId: string): Promise<StoryWorld | null> {
    const world = this.worlds.get(storyId);
    return world ? this.finalize(world) : null;
  }

  async commit(commit: Commit): Promise<CommitResult> {
    const existing = this.worlds.get(commit.storyId) ?? this.createWorld(commit.storyId);
    const applied = applyCommit(existing, commit);
    this.worlds.set(commit.storyId, applied.world);
    this.recordSnapshot(commit.storyId, applied.world);
    return applied.result;
  }

  async getEntity(storyId: string, entityId: string): Promise<Entity | null> {
    const world = this.worlds.get(storyId);
    if (!world) return null;
    const entity = this.finalize(world).entities.find((candidate) => candidate.id === entityId);
    return entity ?? null;
  }

  async queryEvents(storyId: string, query?: EventQuery): Promise<StoryEvent[]> {
    const world = this.worlds.get(storyId);
    if (!world) return [];
    const q = query ?? {};
    let events = world.events;

    if (q.entityId) {
      events = events.filter(
        (event) =>
          event.settingId === q.entityId ||
          event.participants.includes(q.entityId!) ||
          event.involvedObjects.includes(q.entityId!),
      );
    }
    if (q.settingId) events = events.filter((event) => event.settingId === q.settingId);
    if (q.from) events = events.filter((event) => event.createdAt >= q.from!);
    if (q.to) events = events.filter((event) => event.createdAt <= q.to!);

    const offset = q.offset ?? 0;
    return events.slice(offset, offset + (q.limit ?? events.length));
  }

  async byRevision(storyId: string, revision: number): Promise<StoryWorld | null> {
    const snapshot = this.revisions.get(storyId)?.get(revision);
    return snapshot ? this.finalize(snapshot) : null;
  }

  async updateStoryTitle(storyId: string, title: string): Promise<void> {
    const world = this.worlds.get(storyId) ?? this.createWorld(storyId);
    this.worlds.set(storyId, { ...world, title });
  }

  async upsertEntityType(
    storyId: string,
    def: Omit<EntityType, "id" | "createdAt">,
  ): Promise<string> {
    const existingWorld = this.worlds.get(storyId);
    const world = existingWorld ?? this.createWorld(storyId);

    const existing = world.entityTypes.find(
      (type) => type.name.toLowerCase() === def.name.toLowerCase(),
    );
    if (existing) {
      const updated: EntityType = {
        ...existing,
        ...def,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      const entityTypes = world.entityTypes.map((type) =>
        type.id === existing.id ? updated : type,
      );
      this.worlds.set(storyId, { ...world, entityTypes });
      return existing.id;
    }

    const id = identity();
    const type: EntityType = {
      id,
      storyId,
      name: def.name,
      pluralName: def.pluralName,
      baseKind: def.baseKind,
      description: def.description ?? null,
      attributeDefs: def.attributeDefs,
      origin: def.origin,
      supersededBy: def.supersededBy ?? null,
      createdAt: this.now(),
    };
    this.worlds.set(storyId, { ...world, entityTypes: [...world.entityTypes, type] });
    return id;
  }

  async findEntityTypeByName(storyId: string, name: string): Promise<EntityType | null> {
    const world = this.worlds.get(storyId);
    if (!world) return null;
    return (
      world.entityTypes.find(
        (type) => type.name.toLowerCase() === name.toLowerCase(),
      ) ?? null
    );
  }

  async getEntityTypes(storyId: string): Promise<EntityType[]> {
    return this.worlds.get(storyId)?.entityTypes ?? [];
  }

  async findEntityByName(storyId: string, name: string): Promise<Entity | null> {
    const world = this.worlds.get(storyId);
    if (!world) return null;
    const wanted = name.toLowerCase();
    return (
      this.finalize(world).entities.find(
        (entity) =>
          entity.name.toLowerCase() === wanted ||
          entity.aliases.some((alias) => alias.toLowerCase() === wanted),
      ) ?? null
    );
  }

  async listEntities(storyId: string, entityTypeId?: string): Promise<Entity[]> {
    const world = this.worlds.get(storyId);
    if (!world) return [];
    const entities = this.finalize(world).entities;
    return entityTypeId ? entities.filter((entity) => entity.entityTypeId === entityTypeId) : entities;
  }

  async attachMedia(entityId: string, media: Omit<MediaRef, "id" | "createdAt">): Promise<string> {
    const existing = this.mediaByEntity.get(entityId) ?? [];
    const row: MediaRef = {
      id: identity(),
      url: media.url,
      role: media.role,
      caption: media.caption ?? null,
      createdAt: this.now(),
    };
    this.mediaByEntity.set(entityId, [...existing, row]);
    return row.id;
  }

  async getMedia(entityId: string): Promise<MediaRef[]> {
    return this.mediaByEntity.get(entityId) ?? [];
  }

  async removeMedia(entityId: string, mediaId: string): Promise<void> {
    const rows = this.mediaByEntity.get(entityId);
    if (!rows) throw new Error(`media "${mediaId}" not found on entity "${entityId}"`);
    const next = rows.filter((row) => row.id !== mediaId);
    if (next.length === rows.length) {
      throw new Error(`media "${mediaId}" not found on entity "${entityId}"`);
    }
    this.mediaByEntity.set(entityId, next);
  }

  async insertKnowledge(
    storyId: string,
    knowledge: Omit<EntityKnowledge, "id" | "createdAt">,
  ): Promise<string> {
    const row: EntityKnowledge = {
      id: identity(),
      subjectEntityId: knowledge.subjectEntityId,
      factId: knowledge.factId ?? null,
      knowledgeText: knowledge.knowledgeText,
      status: knowledge.status,
      learnedWhen: knowledge.learnedWhen ?? null,
      learnedVia: knowledge.learnedVia ?? null,
      createdAt: this.now(),
    };
    const existing = this.knowledgeBySubject.get(row.subjectEntityId) ?? [];
    this.knowledgeBySubject.set(row.subjectEntityId, [...existing, row]);
    return row.id;
  }

  async getKnowledge(storyId: string, subjectEntityId: string): Promise<EntityKnowledge[]> {
    return this.knowledgeBySubject.get(subjectEntityId) ?? [];
  }

  async listChapters(storyId: string): Promise<Chapter[]> {
    return (this.chaptersStore.get(storyId) ?? []).sort((a, b) => a.position - b.position);
  }

  async createChapter(storyId: string, data: { title: string; position: number }): Promise<string> {
    const id = randomUUID();
    const chapter: Chapter = { id, storyId, title: data.title, position: data.position, createdAt: this.now() };
    const existing = this.chaptersStore.get(storyId) ?? [];
    this.chaptersStore.set(storyId, [...existing, chapter]);
    return id;
  }

  async updateChapter(storyId: string, chapterId: string, patch: { title?: string; position?: number }): Promise<void> {
    const list = this.chaptersStore.get(storyId) ?? [];
    this.chaptersStore.set(storyId, list.map((c) => c.id === chapterId ? { ...c, ...patch } : c));
  }

  async deleteChapter(storyId: string, chapterId: string): Promise<void> {
    const list = this.chaptersStore.get(storyId) ?? [];
    this.chaptersStore.set(storyId, list.filter((c) => c.id !== chapterId));
  }

  async listProseScenes(storyId: string, chapterId?: string): Promise<Scene[]> {
    const all = this.proseScenesStore.get(storyId) ?? [];
    const filtered = chapterId ? all.filter((s) => s.chapterId === chapterId) : all;
    return filtered.sort((a, b) => a.position - b.position);
  }

  async getProseScene(storyId: string, sceneId: string): Promise<Scene | null> {
    const all = this.proseScenesStore.get(storyId) ?? [];
    return all.find((s) => s.id === sceneId) ?? null;
  }

  async createProseScene(storyId: string, data: { chapterId: string; title?: string; content?: string; position: number }): Promise<string> {
    const id = randomUUID();
    const now = this.now();
    const scene: Scene = {
      id,
      storyId,
      chapterId: data.chapterId,
      title: data.title ?? null,
      content: data.content ?? null,
      position: data.position,
      settingId: null,
      when: null,
      summary: null,
      chapterNumber: null,
      eventIds: [],
      participantIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const existing = this.proseScenesStore.get(storyId) ?? [];
    this.proseScenesStore.set(storyId, [...existing, scene]);
    return id;
  }

  async updateProseScene(storyId: string, sceneId: string, patch: { title?: string; content?: string; position?: number }): Promise<void> {
    const list = this.proseScenesStore.get(storyId) ?? [];
    this.proseScenesStore.set(
      storyId,
      list.map((s) => s.id === sceneId ? { ...s, ...patch, updatedAt: this.now() } : s),
    );
  }

  async deleteProseScene(storyId: string, sceneId: string): Promise<void> {
    const list = this.proseScenesStore.get(storyId) ?? [];
    this.proseScenesStore.set(storyId, list.filter((s) => s.id !== sceneId));
  }

  async deleteEntity(storyId: string, entityId: string): Promise<void> {
    const world = this.worlds.get(storyId);
    if (world) world.entities = world.entities.filter((e) => e.id !== entityId);
  }

  async deleteEvent(storyId: string, eventId: string): Promise<void> {
    const world = this.worlds.get(storyId);
    if (world) world.events = world.events.filter((e) => e.id !== eventId);
  }

  async updateEvent(
    storyId: string,
    eventId: string,
    patch: {
      title?: string;
      description?: string | null;
      when?: string | null;
      settingId?: string | null;
      sceneId?: string | null;
      participants?: string[];
      involvedObjects?: string[];
      motivation?: string | null;
      consequences?: string[];
      confidence?: string;
    },
  ): Promise<void> {
    const world = this.worlds.get(storyId);
    if (!world) return;
    const event = world.events.find((e) => e.id === eventId);
    if (!event) return;
    if (patch.title !== undefined) event.title = patch.title;
    if (patch.description !== undefined) event.description = patch.description;
    if (patch.when !== undefined) event.when = patch.when ? { raw: patch.when } : null;
    if (patch.settingId !== undefined) event.settingId = patch.settingId;
    if (patch.sceneId !== undefined) event.sceneId = patch.sceneId;
    if (patch.participants !== undefined) event.participants = patch.participants;
    if (patch.involvedObjects !== undefined) event.involvedObjects = patch.involvedObjects;
    if (patch.motivation !== undefined) event.motivation = patch.motivation;
    if (patch.consequences !== undefined) event.consequences = patch.consequences;
    if (patch.confidence !== undefined) event.confidence = patch.confidence as StoryEvent["confidence"];
  }

  async createEvent(
    storyId: string,
    data: {
      title: string;
      confidence: string;
      description?: string | null;
      when?: string | null;
      settingId?: string | null;
      sceneId?: string | null;
      participants?: string[];
      involvedObjects?: string[];
      motivation?: string | null;
      consequences?: string[];
    },
  ): Promise<string> {
    const world = this.worlds.get(storyId) ?? this.createWorld(storyId);
    const id = randomUUID();
    const event: StoryEvent = {
      id,
      title: data.title,
      description: data.description ?? null,
      settingId: data.settingId ?? null,
      sceneId: data.sceneId ?? null,
      when: data.when ? { raw: data.when } : null,
      motivation: data.motivation ?? null,
      consequences: data.consequences ?? [],
      knowledgeGained: [],
      knowledgeConcealed: [],
      participants: data.participants ?? [],
      involvedObjects: data.involvedObjects ?? [],
      confidence: data.confidence as StoryEvent["confidence"],
      provenance: { dictationId: "", textChunk: "", confidence: data.confidence as StoryEvent["confidence"] },
      createdAt: this.now(),
    };
    this.worlds.set(storyId, { ...world, events: [...world.events, event] });
    return id;
  }
}

export function createMockStoryWorldStore(
  options: MockStoryWorldStoreOptions = {},
): StoryWorldStore {
  return new MockStoryWorldStore(options);
}

export const mockStoryWorldStore = new MockStoryWorldStore();
