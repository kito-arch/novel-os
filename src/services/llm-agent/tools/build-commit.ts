import { randomUUID } from "node:crypto";
import type { StoryWorldStore } from "@/container/story-world-store";
import {
  SupersedeAction,
  validateAttributes,
  type AttributeDef,
  type Commit,
  type CommitResult,
  type Entity,
  type EntityKnowledge,
  type EntityType,
  type Fact,
  type Relationship,
  type StoryEvent,
} from "@/domain";
import type { ProposedAttributeDef } from "@/domain/proposals";
import { Session, type ExtractionSession } from "./session";

export interface BuildCommitOptions {
  dictationId: string;
  textChunk: string;
  clock?: () => Date;
}

function toAttributeDef(def: ProposedAttributeDef): AttributeDef {
  return {
    key: def.key,
    label: def.label,
    kind: def.kind,
    required: def.required ?? false,
    multi: def.multi ?? false,
    enumValues: def.enumValues,
    refType: def.refType,
  };
}

function now(options: BuildCommitOptions): Date {
  return options.clock?.() ?? new Date();
}

// T5.3 — combines every staged op into a single, validation-bound Commit. All
// functions are static; the store is passed explicitly. Provenance
// (dictationId + textChunk) is stamped here by the server — the model never
// authors provenance. The caller persists via StoryWorldStore.commit, whose
// applyCommit gate rejects any commit that breaks world invariants.
export class CommitBuilder {
  static async build(
    store: StoryWorldStore,
    session: ExtractionSession,
    options: BuildCommitOptions,
  ): Promise<Commit> {
    const storyId = session.storyId;
    const world = await store.getWorld(storyId);
    const registryTypes = world?.entityTypes ?? [];
    const registryEntities = world?.entities ?? [];

    // ---- New entity types (deduped against the registry and in-session dupes) --
    const stagedTypeByName = new Map<string, EntityType>();
    const newEntityTypes: EntityType[] = [];
    for (const proposed of session.entityTypes) {
      if (registryTypes.some((type) => Session.normName(type.name) === Session.normName(proposed.name))) continue;
      if (stagedTypeByName.has(Session.normName(proposed.name))) continue;
      const type: EntityType = {
        id: randomUUID(),
        storyId,
        name: proposed.name,
        pluralName: proposed.pluralName,
        baseKind: proposed.baseKind,
        description: proposed.description ?? null,
        attributeDefs: proposed.attributeDefs.map(toAttributeDef),
        origin: "extracted",
        supersededBy: null,
        createdAt: now(options),
      };
      stagedTypeByName.set(Session.normName(proposed.name), type);
      newEntityTypes.push(type);
    }

    const resolveType = (name: string): EntityType | null =>
      stagedTypeByName.get(Session.normName(name)) ??
      registryTypes.find((type) => Session.normName(type.name) === Session.normName(name)) ??
      null;

    // ---- New entities ----------------------------------------------------------
    const byId = new Map<string, Entity>(registryEntities.map((entity) => [entity.id, entity]));
    const usedNames = new Set<string>(registryEntities.map((entity) => Session.normName(entity.name)));
    const entities: Entity[] = [];
    for (const proposed of session.entities) {
      const type = resolveType(proposed.entityTypeName);
      if (!type) continue;
      if (usedNames.has(Session.normName(proposed.name))) continue;
      const validation = validateAttributes(type, proposed.attributes);
      if (!validation.ok) continue;
      const entity: Entity = {
        id: randomUUID(),
        storyId,
        entityTypeId: type.id,
        name: proposed.name,
        aliases: proposed.aliases,
        attributes: validation.attributes,
        media: [],
        createdAt: now(options),
      };
      entities.push(entity);
      byId.set(entity.id, entity);
      usedNames.add(Session.normName(entity.name));
    }

    // ---- Entity updates (merged per entity across world / staged creates) ------
    const entityUpdates: Entity[] = [];
    for (const [identifier, update] of session.updates) {
      const worldBase = registryEntities.find((entity) => entity.id === identifier) ?? null;
      const stagedName = worldBase ? null : Session.stagedEntityNameById(session, identifier);
      const stagedBase = stagedName
        ? session.entities.find((entity) => Session.normName(entity.name) === Session.normName(stagedName))
        : null;
      const base = worldBase ?? (stagedName ? byId.get(Session.stagedEntityIdFor(session, stagedName)) ?? null : null);
      if (!base && !stagedBase) continue;
      const baseEntity = base ?? null;
      const name = baseEntity?.name ?? stagedName;
      if (!name) continue;
      const assembled: Entity = {
        id: baseEntity?.id ?? randomUUID(),
        storyId,
        entityTypeId: baseEntity?.entityTypeId ?? resolveType(stagedBase!.entityTypeName)!.id,
        name,
        aliases: update.aliases ?? baseEntity?.aliases ?? stagedBase!.aliases,
        attributes: {
          ...(baseEntity?.attributes ?? stagedBase!.attributes),
          ...(update.attributes ?? {}),
        },
        media: baseEntity?.media ?? [],
        createdAt: baseEntity?.createdAt ?? now(options),
      };
      entityUpdates.push(assembled);
    }

    const findEntity = (name: string): Entity | null => {
      const key = Session.normName(name);
      return (
        [...byId.values()].find(
          (entity) =>
            Session.normName(entity.name) === key ||
            entity.aliases.some((alias) => Session.normName(alias) === key),
        ) ?? null
      );
    };

    // ---- Events ----------------------------------------------------------------
    const events: StoryEvent[] = session.events.map((proposed) => {
      const setting = proposed.settingName ? findEntity(proposed.settingName) : null;
      return {
        id: randomUUID(),
        title: proposed.title,
        description: proposed.description ?? null,
        settingId: setting?.id ?? null,
        when: proposed.when,
        motivation: proposed.motivation ?? null,
        consequences: proposed.consequences,
        knowledgeGained: proposed.knowledgeGained,
        knowledgeConcealed: proposed.knowledgeConcealed,
        participants: proposed.participantNames
          .map((name) => findEntity(name)?.id)
          .filter((id): id is string => id !== undefined),
        involvedObjects: proposed.involvedObjectNames
          .map((name) => findEntity(name)?.id)
          .filter((id): id is string => id !== undefined),
        confidence: proposed.confidence,
        provenance: {
          dictationId: options.dictationId,
          textChunk: options.textChunk,
          confidence: proposed.confidence,
        },
        createdAt: now(options),
      };
    });

    // ---- Facts (server-stamped provenance) -------------------------------------
    const facts: Fact[] = session.facts.map((claim) => ({
      id: randomUUID(),
      subject: claim.subject,
      predicate: claim.predicate,
      objectValue: claim.objectValue ?? null,
      confidence: claim.confidence,
      provenance: {
        dictationId: options.dictationId,
        textChunk: options.textChunk,
        confidence: claim.confidence,
      },
      supersededBy: null,
      createdAt: now(options),
    }));

    // ---- Relationships ----------------------------------------------------------
    const relationships: Relationship[] = [];
    for (const proposed of session.relationships) {
      const from = findEntity(proposed.fromEntityName);
      const to = findEntity(proposed.toEntityName);
      if (!from || !to) continue;
      relationships.push({
        id: randomUUID(),
        fromEntityId: from.id,
        toEntityId: to.id,
        kind: proposed.kind,
        details: proposed.details ?? null,
        confidence: proposed.confidence,
        provenance: {
          dictationId: options.dictationId,
          textChunk: options.textChunk,
          confidence: proposed.confidence,
        },
        supersededBy: null,
        createdAt: now(options),
      });
    }

    // ---- Knowledge ---------------------------------------------------------------
    const knowledge: EntityKnowledge[] = [];
    for (const proposed of session.knowledge) {
      const subject = findEntity(proposed.subjectEntityName);
      if (!subject) continue;
      knowledge.push({
        id: randomUUID(),
        subjectEntityId: subject.id,
        factId: null,
        knowledgeText: proposed.knowledgeText,
        status: proposed.status,
        learnedWhen: proposed.learnedWhen ?? null,
        learnedVia: proposed.learnedVia ?? null,
        createdAt: now(options),
      });
    }

    // ---- Open questions -----------------------------------------------------------
    const unresolvedById = new Map(
      (world?.openQuestions ?? []).filter((question) => !question.isResolved).map((q) => [q.id, q]),
    );
    const resolvedOpenQuestionIds = [...new Set(session.resolvedOpenQuestionIds)].filter((id) =>
      unresolvedById.has(id),
    );

    // ---- Contradictions + superseded facts ----------------------------------------
    const existingFactIds = new Set((world?.facts ?? []).map((fact) => fact.id));
    const contradictions = session.contradictions.map((contradiction) => ({
      existingFactId: contradiction.existingFactId,
      existingFactDescription: contradiction.existingFactDescription,
      newFactDescription: contradiction.newFactDescription,
      action:
        contradiction.recommendedAction === "flag_soft"
          ? SupersedeAction.FlagSoft
          : contradiction.recommendedAction === "flag_hard"
            ? SupersedeAction.FlagHard
            : contradiction.recommendedAction === "ignore"
              ? SupersedeAction.Ignore
              : SupersedeAction.Supersede,
    }));
    const supersedeFactIds = [...new Set(session.supersedeFactIds)].filter((id) =>
      existingFactIds.has(id),
    );

    return {
      storyId,
      appliedFromRevision: world?.revision ?? 0,
      newEntityTypes,
      entities,
      entityUpdates,
      events,
      facts,
      relationships,
      knowledge,
      scenes: [],
      plotThreads: [],
      openQuestions: [],
      resolvedOpenQuestionIds,
      contradictions,
      supersedeFactIds,
    };
  }

  // Runs CommitBuilder.build through the single validation gate (applyCommit,
  // via StoryWorldStore.commit) and returns the resulting CommitResult. No-op
  // when the session staged nothing.
  static async buildFromStaged(
    store: StoryWorldStore,
    session: ExtractionSession,
    options: BuildCommitOptions,
  ): Promise<CommitResult | null> {
    if (!Session.hasStagedChanges(session)) return null;
    const commit = await CommitBuilder.build(store, session, options);
    return store.commit(commit);
  }
}