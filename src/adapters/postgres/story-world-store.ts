import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Clock } from "@/container/clock";
import type { EventQuery, StoryWorldStore } from "@/container/story-world-store";
import type { Commit, CommitResult } from "@/domain/commits";
import { applyCommit, SupersedeAction } from "@/domain/commits";
import type { Entity, MediaRef } from "@/domain/entities";
import type { AttributeDef, AttributeValue, EntityType } from "@/domain/entity-types";
import type { StoryEvent, TimelineRef } from "@/domain/events";
import type { EntityKnowledge } from "@/domain/knowledge";
import type { OpenQuestion, PlotThread } from "@/domain/plot-threads";
import type { Fact, Provenance } from "@/domain/provenance";
import type { Relationship } from "@/domain/relationships";
import type { Scene } from "@/domain/scenes";
import type { StoryMeta, StoryWorld } from "@/domain/story-world";
import * as schema from "../../../drizzle/schema";
import {
  chapters,
  entityKnowledge,
  entities,
  entityTypes,
  events,
  facts,
  media,
  openQuestions,
  plotThreads,
  relationships,
  scenes,
  stories,
} from "../../../drizzle/schema";
import type { Chapter } from "@/domain/chapters";

export interface PostgresStoryWorldStoreOptions {
  db: PostgresJsDatabase<typeof schema>;
  clock?: Clock;
}

const DEFAULT_TITLE = "Untitled story";
const SYSTEM_OWNER = "system";

function emptyWorld(storyId: string): StoryWorld {
  return {
    id: storyId,
    title: DEFAULT_TITLE,
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

function timelineToColumns(when: TimelineRef | null): {
  whenRaw: string | null;
  whenNormalized: { chapter?: string; day?: string; hour?: string; order: number } | null;
} {
  if (!when) return { whenRaw: null, whenNormalized: null };
  return { whenRaw: when.raw, whenNormalized: when.normalized ?? null };
}

function whenFromColumns(
  whenRaw: string | null,
  whenNormalized: unknown,
): TimelineRef | null {
  if (whenRaw === null) return null;
  return {
    raw: whenRaw,
    normalized:
      (whenNormalized as TimelineRef["normalized"]) === undefined ||
      whenNormalized === null
        ? undefined
        : (whenNormalized as TimelineRef["normalized"]),
  };
}

function provenanceFromColumns(
  dictationId: string | null,
  textChunk: string | null,
  confidence: Fact["confidence"],
): Provenance {
  return {
    dictationId: dictationId ?? "",
    textChunk: textChunk ?? "",
    confidence,
  };
}

// Postgres-backed StoryWorldStore.
//
// Reads reconstruct a StoryWorld by joining the world tables for a story;
// the introducing `revision` column on every world row lets `byRevision(N)`
// rebuild immutable per-commit snapshots. `commit` runs the domain reducer
// `applyCommit` first (the single validation gate), then persists the commit's
// deltas in one transaction, guarded by an optimistic revision bump.
export class PostgresStoryWorldStore implements StoryWorldStore {
  private readonly db: PostgresJsDatabase<typeof schema>;

  constructor(private readonly options: PostgresStoryWorldStoreOptions) {
    this.db = options.db;
  }

  private now(): Date {
    return this.options.clock?.now() ?? new Date();
  }

  // --- World access --------------------------------------------------------
  // `atRevision` caps every world table to rows introduced by that commit;
  // undefined means the current revision.
  private capAt(storyId: string, atRevision?: number) {
    return (table: { storyId: AnyPgColumn; revision: AnyPgColumn }): SQL | undefined =>
      atRevision === undefined
        ? sql`${table.storyId} = ${storyId}`
        : sql`${table.storyId} = ${storyId} AND ${table.revision} <= ${atRevision}`;
  }

  private async readWorld(storyId: string, atRevision?: number): Promise<StoryWorld | null> {
    const at = this.capAt(storyId, atRevision);

    const [storyRows, typeRows, entityRows, factRows, eventRows, relationshipRows, sceneRows, threadRows, questionRows, knowledgeRows] =
      await Promise.all([
        this.db.select().from(stories).where(eq(stories.id, storyId)),
        this.db
          .select()
          .from(entityTypes)
          .where(at(entityTypes))
          .orderBy(asc(entityTypes.revision), asc(entityTypes.createdAt)),
        this.db
          .select()
          .from(entities)
          .where(at(entities))
          .orderBy(asc(entities.revision), asc(entities.createdAt)),
        this.db
          .select()
          .from(facts)
          .where(at(facts))
          .orderBy(asc(facts.revision), asc(facts.createdAt)),
        this.db
          .select()
          .from(events)
          .where(at(events))
          .orderBy(asc(events.createdAt), asc(events.id)),
        this.db
          .select()
          .from(relationships)
          .where(at(relationships))
          .orderBy(asc(relationships.revision), asc(relationships.createdAt)),
        this.db
          .select()
          .from(scenes)
          .where(at(scenes))
          .orderBy(asc(scenes.createdAt), asc(scenes.id)),
        this.db
          .select()
          .from(plotThreads)
          .where(at(plotThreads))
          .orderBy(asc(plotThreads.revision), asc(plotThreads.createdAt)),
        this.db
          .select()
          .from(openQuestions)
          .where(at(openQuestions))
          .orderBy(asc(openQuestions.createdAt), asc(openQuestions.id)),
        this.db
          .select()
          .from(entityKnowledge)
          .where(at(entityKnowledge))
          .orderBy(asc(entityKnowledge.revision), asc(entityKnowledge.createdAt)),
      ]);

    const story = storyRows[0];
    if (!story) return null;

    const world: StoryWorld = {
      id: story.id,
      title: story.title,
      synopsis: story.synopsis,
      storyType: story.storyType,
      revision: atRevision ?? story.revision,
      entityTypes: typeRows.map(entityTypeFromRow),
      entities: entityRows.map(entityFromRow),
      facts: factRows.map(factFromRow),
      events: eventRows.map(eventFromRow),
      relationships: relationshipRows.map(relationshipFromRow),
      knowledge: knowledgeRows.map(knowledgeFromRow),
      scenes: sceneRows.map(sceneFromRow),
      plotThreads: threadRows.map(plotThreadFromRow),
      openQuestions: questionRows.map(openQuestionFromRow),
    };
    return world;
  }

  async getWorld(storyId: string): Promise<StoryWorld | null> {
    const world = await this.readWorld(storyId);
    if (!world) return null;
    return this.finalize(world);
  }

  // Merges auxiliary media (no revision tracking) into entity reads; all
  // knowledge rows already flow through the world tables read.
  private async finalize(world: StoryWorld): Promise<StoryWorld> {
    if (world.entities.length === 0) return world;
    const ids = world.entities.map((entity) => entity.id);
    const mediaRows = await this.db
      .select()
      .from(media)
      .where(inArray(media.entityId, ids))
      .orderBy(asc(media.createdAt));
    const mediaByEntity = new Map<string, MediaRef[]>();
    for (const row of mediaRows) {
      const list = mediaByEntity.get(row.entityId) ?? [];
      list.push(mediaRefFromRow(row));
      mediaByEntity.set(row.entityId, list);
    }
    return {
      ...world,
      entities: world.entities.map((entity) => {
        const attached = mediaByEntity.get(entity.id);
        return attached?.length ? { ...entity, media: attached } : entity;
      }),
    };
  }

  async commit(commit: Commit): Promise<CommitResult> {
    const existingStory = await this.db
      .select({ id: stories.id, revision: stories.revision })
      .from(stories)
      .where(eq(stories.id, commit.storyId))
      .limit(1);
    const world = existingStory[0]
      ? ((await this.readWorld(commit.storyId)) ?? emptyWorld(commit.storyId))
      : emptyWorld(commit.storyId);

    // applyCommit is the single validation gate: revision mismatch, duplicate
    // entities, unknown types, invalid attributes and unknown supersede
    // targets all throw here — before any write.
    const applied = applyCommit(world, commit);

    const supersededMap = this.computeSupersededMap(commit, world);

    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(stories)
        .values({
          id: commit.storyId,
          title: DEFAULT_TITLE,
          ownerId: SYSTEM_OWNER,
          updatedAt: this.now(),
        })
        .onConflictDoNothing();

      // Optimistic concurrency guard: only advance the story revision if it
      // still matches what this commit was based on.
      const bumped = await tx
        .update(stories)
        .set({ revision: applied.result.revision, updatedAt: this.now() })
        .where(
          and(
            eq(stories.id, commit.storyId),
            eq(stories.revision, commit.appliedFromRevision),
          ),
        )
        .returning({ revision: stories.revision });
      if (bumped.length === 0) {
        throw new Error(
          `revision mismatch: commit was based on revision ${commit.appliedFromRevision}, story no longer matches`,
        );
      }

      if (commit.newEntityTypes.length > 0) {
        await tx.insert(entityTypes).values(
          commit.newEntityTypes.map((type) => entityTypeToRow(type, applied.result.revision)),
        );
      }
      if (commit.entities.length > 0) {
        await tx.insert(entities).values(
          commit.entities.map((entity) => entityToRow(entity, applied.result.revision)),
        );
      }
      for (const update of commit.entityUpdates) {
        await tx
          .update(entities)
          .set({ name: update.name, aliases: update.aliases, attributes: update.attributes })
          .where(eq(entities.id, update.id));
      }
      if (commit.events.length > 0) {
        await tx.insert(events).values(
          commit.events.map((event) => eventToRow(event, commit.storyId, applied.result.revision)),
        );
      }
      if (commit.facts.length > 0) {
        await tx.insert(facts).values(
          commit.facts.map((fact) => factToRow(fact, commit.storyId, applied.result.revision)),
        );
      }
      for (const [factId, replacementId] of supersededMap) {
        await tx.update(facts).set({ supersededBy: replacementId }).where(eq(facts.id, factId));
      }
      if (commit.relationships.length > 0) {
        await tx.insert(relationships).values(
          commit.relationships.map((relationship) =>
            relationshipToRow(relationship, commit.storyId, applied.result.revision),
          ),
        );
      }
      if (commit.knowledge.length > 0) {
        await tx.insert(entityKnowledge).values(
          commit.knowledge.map((knowledge) =>
            knowledgeToRow(knowledge, commit.storyId, applied.result.revision),
          ),
        );
      }
      if (commit.scenes.length > 0) {
        await tx.insert(scenes).values(
          commit.scenes.map((scene) => sceneToRow(scene, commit.storyId, applied.result.revision)),
        );
      }
      if (commit.plotThreads.length > 0) {
        await tx.insert(plotThreads).values(
          commit.plotThreads.map((thread) =>
            plotThreadToRow(thread, commit.storyId, applied.result.revision),
          ),
        );
      }
      if (commit.openQuestions.length > 0) {
        await tx.insert(openQuestions).values(
          commit.openQuestions.map((question) =>
            openQuestionToRow(question, commit.storyId, applied.result.revision),
          ),
        );
      }
      for (const questionId of commit.resolvedOpenQuestionIds) {
        await tx
          .update(openQuestions)
          .set({ isResolved: true, resolvedInDictationId: null })
          .where(eq(openQuestions.id, questionId));
      }

      return applied.result.revision;
    });

    return { ...applied.result, revision };
  }

  // Mirrors applyCommit's supersede mapping so the persisted supersededBy
  // values match the domain world.
  private computeSupersededMap(commit: Commit, world: StoryWorld): Map<string, string> {
    const supersededMap = new Map<string, string>();
    const newFactIds = new Map(commit.facts.map((fact) => [fact.id, fact]));
    for (const factId of commit.supersedeFactIds) {
      supersededMap.set(factId, randomUUID());
    }
    for (const contradiction of commit.contradictions) {
      if (contradiction.action !== SupersedeAction.Supersede) continue;
      if (contradiction.existingFactId === null) continue;
      const existing = world.facts.find((fact) => fact.id === contradiction.existingFactId);
      if (!existing) continue;
      const replacement =
        newFactIds.get(existing.id)?.id ?? commit.facts[0]?.id ?? randomUUID();
      supersededMap.set(existing.id, replacement);
    }
    return supersededMap;
  }

  async getEntity(storyId: string, entityId: string): Promise<Entity | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.storyId, storyId), eq(entities.id, entityId)))
      .limit(1);
    if (!rows[0]) return null;
    return this.withMedia(entityFromRow(rows[0]));
  }

  async queryEvents(storyId: string, query?: EventQuery): Promise<StoryEvent[]> {
    const q = query ?? {};
    const conditions: SQL[] = [eq(events.storyId, storyId)];
    if (q.settingId) conditions.push(eq(events.settingId, q.settingId));
    if (q.entityId) {
      conditions.push(
        or(
          eq(events.settingId, q.entityId),
          sql`${events.participants} @> ${JSON.stringify([q.entityId])}::jsonb`,
          sql`${events.involvedObjects} @> ${JSON.stringify([q.entityId])}::jsonb`,
        ) as SQL,
      );
    }
    if (q.from) conditions.push(gte(events.createdAt, q.from));
    if (q.to) conditions.push(lte(events.createdAt, q.to));

    const rows = await this.db
      .select()
      .from(events)
      .where(and(...conditions))
      .orderBy(asc(events.createdAt), asc(events.id))
      .limit(q.limit ?? 1000)
      .offset(q.offset ?? 0);

    return rows.map(eventFromRow);
  }

  async byRevision(storyId: string, revision: number): Promise<StoryWorld | null> {
    return this.readWorld(storyId, revision);
  }

  async listStories(ownerId: string): Promise<StoryMeta[]> {
    const rows = await this.db
      .select({ id: stories.id, title: stories.title, createdAt: stories.createdAt })
      .from(stories)
      .where(eq(stories.ownerId, ownerId))
      .orderBy(sql`${stories.createdAt} DESC`);
    return rows.map((row) => ({ id: row.id, title: row.title, createdAt: row.createdAt }));
  }

  async createStory(id: string, data: { title: string; ownerId: string }): Promise<void> {
    await this.db
      .insert(stories)
      .values({ id, title: data.title, ownerId: data.ownerId, updatedAt: this.now() })
      .onConflictDoNothing();
  }

  async updateStoryTitle(storyId: string, title: string): Promise<void> {
    await this.ensureStoryRow(storyId);
    await this.db
      .update(stories)
      .set({ title, updatedAt: this.now() })
      .where(eq(stories.id, storyId));
  }

  // --- Entity-type registry --------------------------------------------------
  async upsertEntityType(storyId: string, def: Omit<EntityType, "id" | "createdAt">): Promise<string> {
    await this.ensureStoryRow(storyId);
    const existing = await this.db
      .select()
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.storyId, storyId),
          sql`lower(${entityTypes.name}) = lower(${def.name})`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(entityTypes)
        .set({
          pluralName: def.pluralName,
          description: def.description,
          baseKind: def.baseKind,
          attributeDefs: def.attributeDefs as AttributeDef[],
          origin: def.origin,
          supersededBy: def.supersededBy,
        })
        .where(eq(entityTypes.id, existing[0].id));
      return existing[0].id;
    }

    const id = randomUUID();
    await this.db.insert(entityTypes).values(
      entityTypeToRow(
        {
          ...def,
          id,
          storyId,
          createdAt: this.now(),
        } as EntityType,
        0,
      ),
    );
    return id;
  }

  async getEntityTypes(storyId: string): Promise<EntityType[]> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.storyId, storyId))
      .orderBy(asc(entityTypes.revision), asc(entityTypes.createdAt));
    return rows.map(entityTypeFromRow);
  }

  async findEntityTypeByName(storyId: string, name: string): Promise<EntityType | null> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .where(
        and(
          eq(entityTypes.storyId, storyId),
          sql`lower(${entityTypes.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    return rows[0] ? entityTypeFromRow(rows[0]) : null;
  }

  // --- Entities ---------------------------------------------------------------
  async findEntityByName(storyId: string, name: string): Promise<Entity | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.storyId, storyId),
          or(
            sql`lower(${entities.name}) = lower(${name})`,
            sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${entities.aliases}) AS alias_value WHERE lower(alias_value) = lower(${name}))`,
          ) as SQL,
        ),
      )
      .limit(1);
    return rows[0] ? this.withMedia(entityFromRow(rows[0])) : null;
  }

  async listEntities(storyId: string, entityTypeId?: string): Promise<Entity[]> {
    const where = entityTypeId
      ? and(eq(entities.storyId, storyId), eq(entities.entityTypeId, entityTypeId))
      : eq(entities.storyId, storyId);
    const rows = await this.db
      .select()
      .from(entities)
      .where(where)
      .orderBy(asc(entities.revision), asc(entities.createdAt));
    return Promise.all(rows.map(async (row) => this.withMedia(entityFromRow(row))));
  }

  private async withMedia(entity: Entity): Promise<Entity> {
    const mediaRows = await this.db
      .select()
      .from(media)
      .where(eq(media.entityId, entity.id))
      .orderBy(asc(media.createdAt));
    if (mediaRows.length === 0) return entity;
    return { ...entity, media: mediaRows.map(mediaRefFromRow) };
  }

  // --- Media ------------------------------------------------------------------
  async attachMedia(entityId: string, mediaInput: Omit<MediaRef, "id" | "createdAt">): Promise<string> {
    const id = randomUUID();
    await this.db.insert(media).values({
      id,
      entityId,
      url: mediaInput.url,
      role: mediaInput.role,
      caption: mediaInput.caption,
      createdAt: this.now(),
    });
    return id;
  }

  async getMedia(entityId: string): Promise<MediaRef[]> {
    const rows = await this.db
      .select()
      .from(media)
      .where(eq(media.entityId, entityId))
      .orderBy(asc(media.createdAt));
    return rows.map(mediaRefFromRow);
  }

  async removeMedia(entityId: string, mediaId: string): Promise<void> {
    const result = await this.db
      .delete(media)
      .where(and(eq(media.id, mediaId), eq(media.entityId, entityId)))
      .returning({ id: media.id });
    if (result.length === 0) {
      throw new Error(`media "${mediaId}" not found on entity "${entityId}"`);
    }
  }

  // --- Knowledge ---------------------------------------------------------------
  async insertKnowledge(
    storyId: string,
    knowledge: Omit<EntityKnowledge, "id" | "createdAt">,
  ): Promise<string> {
    const storyRevision = await this.currentRevision(storyId);
    const id = randomUUID();
    await this.db.insert(entityKnowledge).values({
      id,
      storyId,
      subjectEntityId: knowledge.subjectEntityId,
      factId: knowledge.factId,
      knowledgeText: knowledge.knowledgeText,
      status: knowledge.status,
      learnedWhen: knowledge.learnedWhen,
      learnedVia: knowledge.learnedVia,
      revision: storyRevision,
      createdAt: this.now(),
    });
    return id;
  }

  async getKnowledge(storyId: string, subjectEntityId: string): Promise<EntityKnowledge[]> {
    const rows = await this.db
      .select()
      .from(entityKnowledge)
      .where(
        and(eq(entityKnowledge.storyId, storyId), eq(entityKnowledge.subjectEntityId, subjectEntityId)),
      )
      .orderBy(asc(entityKnowledge.createdAt));
    return rows.map(knowledgeFromRow);
  }

  // --- Chapters & prose scenes -------------------------------------------------
  async listChapters(storyId: string): Promise<Chapter[]> {
    const rows = await this.db
      .select()
      .from(chapters)
      .where(eq(chapters.storyId, storyId))
      .orderBy(asc(chapters.position), asc(chapters.createdAt));
    return rows.map(chapterFromRow);
  }

  async createChapter(storyId: string, data: { title: string; position: number }): Promise<string> {
    await this.ensureStoryRow(storyId);
    const id = randomUUID();
    await this.db.insert(chapters).values({
      id,
      storyId,
      title: data.title,
      position: data.position,
      createdAt: this.now(),
    });
    return id;
  }

  async updateChapter(
    storyId: string,
    chapterId: string,
    patch: { title?: string; position?: number },
  ): Promise<void> {
    await this.db
      .update(chapters)
      .set({ ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.position !== undefined ? { position: patch.position } : {}) })
      .where(and(eq(chapters.id, chapterId), eq(chapters.storyId, storyId)));
  }

  async deleteChapter(storyId: string, chapterId: string): Promise<void> {
    await this.db
      .delete(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.storyId, storyId)));
  }

  async listProseScenes(storyId: string, chapterId?: string): Promise<Scene[]> {
    const cond = chapterId
      ? and(eq(scenes.storyId, storyId), eq(scenes.chapterId, chapterId))
      : eq(scenes.storyId, storyId);
    const rows = await this.db
      .select()
      .from(scenes)
      .where(cond)
      .orderBy(asc(scenes.position), asc(scenes.createdAt));
    return rows.map(sceneFromRow);
  }

  async getProseScene(storyId: string, sceneId: string): Promise<Scene | null> {
    const rows = await this.db
      .select()
      .from(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.storyId, storyId)))
      .limit(1);
    return rows[0] ? sceneFromRow(rows[0]) : null;
  }

  async createProseScene(
    storyId: string,
    data: { chapterId: string; title?: string; content?: string; position: number },
  ): Promise<string> {
    await this.ensureStoryRow(storyId);
    const id = randomUUID();
    const now = this.now();
    await this.db.insert(scenes).values({
      id,
      storyId,
      chapterId: data.chapterId,
      title: data.title ?? null,
      content: data.content ?? null,
      position: data.position,
      eventIds: [],
      participantIds: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async updateProseScene(
    storyId: string,
    sceneId: string,
    patch: { title?: string; content?: string; position?: number },
  ): Promise<void> {
    const update: Record<string, unknown> = { updatedAt: this.now() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.content !== undefined) update.content = patch.content;
    if (patch.position !== undefined) update.position = patch.position;
    await this.db
      .update(scenes)
      .set(update)
      .where(and(eq(scenes.id, sceneId), eq(scenes.storyId, storyId)));
  }

  async deleteProseScene(storyId: string, sceneId: string): Promise<void> {
    await this.db
      .delete(scenes)
      .where(and(eq(scenes.id, sceneId), eq(scenes.storyId, storyId)));
  }

  // --- Helpers ----------------------------------------------------------------
  private async ensureStoryRow(storyId: string): Promise<void> {
    await this.db
      .insert(stories)
      .values({
        id: storyId,
        title: DEFAULT_TITLE,
        ownerId: SYSTEM_OWNER,
        updatedAt: this.now(),
      })
      .onConflictDoNothing();
  }

  private async currentRevision(storyId: string): Promise<number> {
    const rows = await this.db
      .select({ revision: stories.revision })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1);
    return rows[0]?.revision ?? 0;
  }
}

// --- Row <-> domain mappers ---------------------------------------------------
function entityTypeToRow(type: EntityType, revision: number) {
  return {
    id: type.id,
    storyId: type.storyId,
    name: type.name,
    pluralName: type.pluralName,
    description: type.description,
    baseKind: type.baseKind,
    attributeDefs: type.attributeDefs,
    origin: type.origin,
    supersededBy: type.supersededBy,
    revision,
    createdAt: type.createdAt,
  };
}

function entityTypeFromRow(row: typeof entityTypes.$inferSelect): EntityType {
  return {
    id: row.id,
    storyId: row.storyId,
    name: row.name,
    pluralName: row.pluralName,
    baseKind: row.baseKind as EntityType["baseKind"],
    description: row.description,
    attributeDefs: (row.attributeDefs ?? []) as AttributeDef[],
    origin: row.origin as EntityType["origin"],
    supersededBy: row.supersededBy,
    createdAt: row.createdAt,
  };
}

function entityToRow(entity: Entity, revision: number) {
  return {
    id: entity.id,
    storyId: entity.storyId,
    entityTypeId: entity.entityTypeId,
    name: entity.name,
    aliases: entity.aliases,
    attributes: entity.attributes as Record<string, AttributeValue>,
    revision,
    createdAt: entity.createdAt,
  };
}

function entityFromRow(row: typeof entities.$inferSelect): Entity {
  return {
    id: row.id,
    storyId: row.storyId,
    entityTypeId: row.entityTypeId,
    name: row.name,
    aliases: (row.aliases ?? []) as string[],
    attributes: (row.attributes ?? {}) as Record<string, AttributeValue>,
    media: [],
    createdAt: row.createdAt,
  };
}

function mediaRefFromRow(row: typeof media.$inferSelect): MediaRef {
  return {
    id: row.id,
    url: row.url,
    role: row.role as MediaRef["role"],
    caption: row.caption,
    createdAt: row.createdAt,
  };
}

function factToRow(fact: Fact, storyId: string, revision: number) {
  return {
    id: fact.id,
    storyId,
    subject: fact.subject,
    predicate: fact.predicate,
    objectValue: fact.objectValue,
    confidence: fact.confidence,
    provenanceDictationId: fact.provenance.dictationId,
    provenanceText: fact.provenance.textChunk,
    supersededBy: fact.supersededBy,
    revision,
    createdAt: fact.createdAt,
  };
}

function factFromRow(row: typeof facts.$inferSelect): Fact {
  return {
    id: row.id,
    subject: row.subject,
    predicate: row.predicate,
    objectValue: row.objectValue ?? null,
    confidence: row.confidence,
    provenance: provenanceFromColumns(row.provenanceDictationId, row.provenanceText, row.confidence),
    supersededBy: row.supersededBy ?? null,
    createdAt: row.createdAt,
  };
}

function eventToRow(event: StoryEvent, storyId: string, revision: number) {
  const { whenRaw, whenNormalized } = timelineToColumns(event.when);
  return {
    id: event.id,
    storyId,
    title: event.title,
    description: event.description,
    settingId: event.settingId,
    whenRaw,
    whenNormalized,
    motivation: event.motivation,
    consequences: event.consequences,
    knowledgeGained: event.knowledgeGained,
    knowledgeConcealed: event.knowledgeConcealed,
    participants: event.participants,
    involvedObjects: event.involvedObjects,
    confidence: event.confidence,
    provenanceDictationId: event.provenance.dictationId,
    provenanceText: event.provenance.textChunk,
    revision,
    createdAt: event.createdAt,
  };
}

function eventFromRow(row: typeof events.$inferSelect): StoryEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    settingId: row.settingId,
    when: whenFromColumns(row.whenRaw, row.whenNormalized),
    motivation: row.motivation,
    consequences: (row.consequences ?? []) as string[],
    knowledgeGained: (row.knowledgeGained ?? []) as string[],
    knowledgeConcealed: (row.knowledgeConcealed ?? []) as string[],
    participants: (row.participants ?? []) as string[],
    involvedObjects: (row.involvedObjects ?? []) as string[],
    confidence: row.confidence,
    provenance: provenanceFromColumns(row.provenanceDictationId, row.provenanceText, row.confidence),
    createdAt: row.createdAt,
  };
}

function relationshipToRow(relationship: Relationship, storyId: string, revision: number) {
  return {
    id: relationship.id,
    storyId,
    fromEntityId: relationship.fromEntityId,
    toEntityId: relationship.toEntityId,
    kind: relationship.kind,
    details: relationship.details,
    confidence: relationship.confidence,
    provenanceDictationId: relationship.provenance.dictationId,
    provenanceText: relationship.provenance.textChunk,
    supersededBy: relationship.supersededBy,
    revision,
    createdAt: relationship.createdAt,
  };
}

function relationshipFromRow(row: typeof relationships.$inferSelect): Relationship {
  return {
    id: row.id,
    fromEntityId: row.fromEntityId,
    toEntityId: row.toEntityId,
    kind: row.kind,
    details: row.details,
    confidence: row.confidence,
    provenance: provenanceFromColumns(row.provenanceDictationId, row.provenanceText, row.confidence),
    supersededBy: row.supersededBy ?? null,
    createdAt: row.createdAt,
  };
}

function knowledgeToRow(knowledge: EntityKnowledge, storyId: string, revision: number) {
  return {
    id: knowledge.id,
    storyId,
    subjectEntityId: knowledge.subjectEntityId,
    factId: knowledge.factId,
    knowledgeText: knowledge.knowledgeText,
    status: knowledge.status,
    learnedWhen: knowledge.learnedWhen,
    learnedVia: knowledge.learnedVia,
    revision,
    createdAt: knowledge.createdAt,
  };
}

function knowledgeFromRow(row: typeof entityKnowledge.$inferSelect): EntityKnowledge {
  return {
    id: row.id,
    subjectEntityId: row.subjectEntityId,
    factId: row.factId,
    knowledgeText: row.knowledgeText,
    status: row.status,
    learnedWhen: row.learnedWhen,
    learnedVia: row.learnedVia,
    createdAt: row.createdAt,
  };
}

function sceneToRow(scene: Scene, storyId: string, revision: number) {
  const { whenRaw, whenNormalized } = timelineToColumns(scene.when);
  return {
    id: scene.id,
    storyId,
    title: scene.title,
    settingId: scene.settingId,
    whenRaw,
    whenNormalized,
    summary: scene.summary,
    chapterNumber: scene.chapterNumber,
    chapterId: scene.chapterId,
    position: scene.position,
    content: scene.content,
    eventIds: scene.eventIds,
    participantIds: scene.participantIds,
    revision,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  };
}

function sceneFromRow(row: typeof scenes.$inferSelect): Scene {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    settingId: row.settingId,
    when: whenFromColumns(row.whenRaw, row.whenNormalized),
    summary: row.summary,
    chapterNumber: row.chapterNumber ?? null,
    chapterId: row.chapterId ?? null,
    position: row.position ?? 0,
    content: row.content ?? null,
    eventIds: (row.eventIds ?? []) as string[],
    participantIds: (row.participantIds ?? []) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt ?? row.createdAt,
  };
}

function chapterFromRow(row: typeof chapters.$inferSelect): Chapter {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    position: row.position,
    createdAt: row.createdAt,
  };
}

function plotThreadToRow(thread: PlotThread, storyId: string, revision: number) {
  return {
    id: thread.id,
    storyId,
    title: thread.title,
    description: thread.description,
    status: thread.status,
    introducedInSceneId: thread.introducedInSceneId,
    lastMentionedInSceneId: thread.lastMentionedInSceneId,
    relatedEntityIds: thread.relatedEntityIds,
    revision,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

function plotThreadFromRow(row: typeof plotThreads.$inferSelect): PlotThread {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    introducedInSceneId: row.introducedInSceneId,
    lastMentionedInSceneId: row.lastMentionedInSceneId,
    relatedEntityIds: (row.relatedEntityIds ?? []) as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function openQuestionToRow(question: OpenQuestion, storyId: string, revision: number) {
  return {
    id: question.id,
    storyId,
    question: question.question,
    relatedEntityIds: question.relatedEntityIds,
    introducedInDictationId: question.introducedInDictationId,
    resolvedInDictationId: question.resolvedInDictationId,
    isResolved: question.isResolved,
    revision,
    createdAt: question.createdAt,
  };
}

function openQuestionFromRow(row: typeof openQuestions.$inferSelect): OpenQuestion {
  return {
    id: row.id,
    question: row.question,
    relatedEntityIds: (row.relatedEntityIds ?? []) as string[],
    introducedInDictationId: row.introducedInDictationId,
    resolvedInDictationId: row.resolvedInDictationId,
    isResolved: row.isResolved,
    createdAt: row.createdAt,
  };
}