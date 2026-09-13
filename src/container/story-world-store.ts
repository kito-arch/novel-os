import type { Commit, CommitResult } from "../domain/commits";
import type { Entity, MediaRef } from "../domain/entities";
import type { EntityType } from "../domain/entity-types";
import type { StoryEvent } from "../domain/events";
import type { EntityKnowledge } from "../domain/knowledge";
import type { StoryWorld } from "../domain/story-world";

export interface EntityRef {
  id: string;
  name: string;
  entityTypeId: string;
  aliases: string[];
}

export interface EventQuery {
  entityId?: string;
  settingId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface Snapshot {
  revision: number;
  entityCount: number;
  factCount: number;
  eventCount: number;
  updatedAt: Date;
}

export interface StoryWorldStore {
  // World access + append-only revision history.
  getWorld(storyId: string): Promise<StoryWorld | null>;
  commit(commit: Commit): Promise<CommitResult>;
  getEntity(storyId: string, entityId: string): Promise<Entity | null>;
  queryEvents(storyId: string, query?: EventQuery): Promise<StoryEvent[]>;
  byRevision(storyId: string, revision: number): Promise<StoryWorld | null>;

  // Entity-type registry: the dynamic entity model.
  upsertEntityType(storyId: string, def: Omit<EntityType, "id" | "createdAt">): Promise<string>;
  getEntityTypes(storyId: string): Promise<EntityType[]>;
  findEntityTypeByName(storyId: string, name: string): Promise<EntityType | null>;

  // Type-agnostic entity operations. No per-entity-kind methods, ever.
  findEntityByName(storyId: string, name: string): Promise<Entity | null>;
  listEntities(storyId: string, entityTypeId?: string): Promise<Entity[]>;

  // Media (only for base kinds that support it).
  attachMedia(entityId: string, media: Omit<MediaRef, "id" | "createdAt">): Promise<string>;
  getMedia(entityId: string): Promise<MediaRef[]>;

  // Knowledge: any entity type can "know".
  insertKnowledge(
    storyId: string,
    knowledge: Omit<EntityKnowledge, "id" | "createdAt">,
  ): Promise<string>;
  getKnowledge(storyId: string, subjectEntityId: string): Promise<EntityKnowledge[]>;
}