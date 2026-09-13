import { randomUUID } from "node:crypto";
import type { Entity } from "./entities";
import { validateEntity } from "./entities";
import type { EntityType } from "./entity-types";
import type { StoryEvent } from "./events";
import type { EntityKnowledge } from "./knowledge";
import type { OpenQuestion, PlotThread } from "./plot-threads";
import type { Fact } from "./provenance";
import type { Relationship } from "./relationships";
import type { Scene } from "./scenes";
import { listActiveFacts } from "./provenance";
import type { StoryWorld } from "./story-world";

export enum SupersedeAction {
  Supersede = "supersede",
  FlagSoft = "flag_soft",
  FlagHard = "flag_hard",
  Ignore = "ignore",
}

export interface CommitContradiction {
  existingFactId: string | null;
  existingFactDescription: string;
  newFactDescription: string;
  action: SupersedeAction;
}

export interface Commit {
  storyId: string;
  appliedFromRevision: number;
  newEntityTypes: EntityType[];
  entities: Entity[];
  entityUpdates: Entity[];
  events: StoryEvent[];
  facts: Fact[];
  relationships: Relationship[];
  knowledge: EntityKnowledge[];
  scenes: Scene[];
  plotThreads: PlotThread[];
  openQuestions: OpenQuestion[];
  contradictions: CommitContradiction[];
  supersedeFactIds: string[];
}

export interface CommitResult {
  revision: number;
  entityTypesCreated: number;
  entitiesCreated: number;
  entitiesUpdated: number;
  entitiesCreatedByType: Record<string, number>;
  eventsAdded: number;
  factsAdded: number;
  relationshipsAdded: number;
  knowledgeAdded: number;
  scenesAdded: number;
  plotThreadsUpdated: number;
  openQuestionsAdded: number;
  contradictionsFound: number;
  factsSuperseded: number;
}

export interface ApplyCommitResult {
  world: StoryWorld;
  result: CommitResult;
}

export function emptyCommit(storyId: string, revision: number): Commit {
  return {
    storyId,
    appliedFromRevision: revision,
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
    supersedeFactIds: [],
  };
}

function fail(message: string): never {
  throw new Error(`applyCommit: ${message}`);
}

export function applyCommit(world: StoryWorld, commit: Commit): ApplyCommitResult {
  if (commit.storyId !== world.id) {
    fail(`storyId mismatch: commit targets "${commit.storyId}", world is "${world.id}"`);
  }
  if (commit.appliedFromRevision !== world.revision) {
    fail(
      `revision mismatch: commit was based on revision ${commit.appliedFromRevision}, world is at ${world.revision}`,
    );
  }

  const entityTypes = [...world.entityTypes, ...commit.newEntityTypes];

  const existingTypeNames = new Set(world.entityTypes.map((type) => type.name));
  for (const type of commit.newEntityTypes) {
    if (existingTypeNames.has(type.name)) {
      fail(`duplicate entity type name "${type.name}"`);
    }
    existingTypeNames.add(type.name);
  }

  const typeById = new Map(entityTypes.map((type) => [type.id, type]));

  const existingEntityIds = new Set(world.entities.map((entity) => entity.id));

  const added: Entity[] = [];
  for (const entity of commit.entities) {
    if (existingEntityIds.has(entity.id)) {
      fail(`entity "${entity.name}" already exists in the world`);
    }
    const entityType = typeById.get(entity.entityTypeId);
    if (!entityType) {
      fail(`entity "${entity.name}" references unknown entity type id "${entity.entityTypeId}"`);
    }
    const validation = validateEntity(entityType, entity);
    if (!validation.ok) {
      fail(`entity "${entity.name}" is invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
    }
    existingEntityIds.add(entity.id);
    added.push(entity);
  }

  const updates: Entity[] = [];
  for (const entity of commit.entityUpdates) {
    const entityType = typeById.get(entity.entityTypeId);
    if (!entityType) {
      fail(`entity update "${entity.name}" references unknown entity type id "${entity.entityTypeId}"`);
    }
    const validation = validateEntity(entityType, entity);
    if (!validation.ok) {
      fail(`entity update "${entity.name}" is invalid: ${validation.errors.map((e) => e.message).join("; ")}`);
    }
    updates.push(entity);
  }

  const newFactIds = new Map(commit.facts.map((fact) => [fact.id, fact]));
  const supersededFactIds = new Set<string>();
  const supersedeMap = new Map<string, string[]>();
  const markSuperseded = (factId: string, replacementId: string): void => {
    supersededFactIds.add(factId);
    const mapping = supersedeMap.get(factId) ?? [];
    mapping.push(replacementId);
    supersedeMap.set(factId, mapping);
  };

  for (const factId of commit.supersedeFactIds) {
    if (!world.facts.some((fact) => fact.id === factId)) {
      fail(`cannot supersede unknown fact id "${factId}"`);
    }
    markSuperseded(factId, randomUUID());
  }

  for (const contradiction of commit.contradictions) {
    if (contradiction.action !== SupersedeAction.Supersede) continue;
    if (contradiction.existingFactId === null) continue;
    if (!world.facts.some((fact) => fact.id === contradiction.existingFactId)) {
      fail(`cannot supersede unknown fact id "${contradiction.existingFactId}"`);
    }
    const existing = world.facts.find((fact) => fact.id === contradiction.existingFactId)!;
    const replacement =
      newFactIds.get(existing.id)?.id ??
      commit.facts[0]?.id ??
      randomUUID();
    markSuperseded(existing.id, replacement);
  }

  const facts = [
    ...world.facts.map((fact) => {
      if (!supersededFactIds.has(fact.id)) return fact;
      const replacementIds = supersedeMap.get(fact.id)!;
      return { ...fact, supersededBy: replacementIds[0] };
    }),
    ...commit.facts,
  ];

  const entities = [...world.entities, ...added].map((entity) => {
    const update = updates.find((candidate) => candidate.id === entity.id);
    return update ? { ...entity, ...update, media: update.media } : entity;
  });

  const entitiesCreatedByType: Record<string, number> = {};
  for (const entity of added) {
    const entityType = typeById.get(entity.entityTypeId)!;
    entitiesCreatedByType[entityType.name] = (entitiesCreatedByType[entityType.name] ?? 0) + 1;
  }

  const result: CommitResult = {
    revision: world.revision + 1,
    entityTypesCreated: commit.newEntityTypes.length,
    entitiesCreated: added.length,
    entitiesUpdated: updates.length,
    entitiesCreatedByType,
    eventsAdded: commit.events.length,
    factsAdded: commit.facts.length,
    relationshipsAdded: commit.relationships.length,
    knowledgeAdded: commit.knowledge.length,
    scenesAdded: commit.scenes.length,
    plotThreadsUpdated: commit.plotThreads.length,
    openQuestionsAdded: commit.openQuestions.length,
    contradictionsFound: commit.contradictions.length,
    factsSuperseded: supersededFactIds.size,
  };

  return {
    world: {
      ...world,
      revision: result.revision,
      entityTypes,
      entities,
      facts,
      events: [...world.events, ...commit.events],
      relationships: [...world.relationships, ...commit.relationships],
      knowledge: [...world.knowledge, ...commit.knowledge],
      scenes: [...world.scenes, ...commit.scenes],
      plotThreads: [...world.plotThreads, ...commit.plotThreads],
      openQuestions: [...world.openQuestions, ...commit.openQuestions],
    },
    result,
  };
}

export function activeFacts(world: StoryWorld): Fact[] {
  return listActiveFacts(world.facts);
}