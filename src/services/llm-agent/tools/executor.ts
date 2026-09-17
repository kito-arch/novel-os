import { randomUUID } from "node:crypto";
import type { StoryWorldStore } from "@/container/story-world-store";
import { BASE_KIND_CATALOG, MULTI_ALLOWED_KINDS, listActiveFacts, validateAttributes } from "@/domain";
import { KnowledgeStatusSchema } from "@/domain/knowledge";
import type { AttributeDef, AttributeValue, EntityType, StoryWorld } from "@/domain";
import type { ProposedEntityType } from "@/domain/proposals";
import {
  DEFAULT_LIMIT,
  MAX_FETCHES,
  MAX_LIMIT,
  MAX_TOOL_CALLS,
  TOOL_FINISH,
  TOOL_GET_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_LIST_ENTITY_TYPES,
  TOOL_QUERY_EVENTS,
  TOOL_STAGE_CREATE_ENTITY,
  TOOL_STAGE_CREATE_ENTITY_TYPE,
  TOOL_STAGE_CREATE_EVENT,
  TOOL_STAGE_CREATE_FACT,
  TOOL_STAGE_CREATE_RELATIONSHIP,
  TOOL_STAGE_RESOLVE_OPEN_QUESTION,
  TOOL_STAGE_UPDATE_ENTITY,
  TOOL_STAGE_UPDATE_KNOWLEDGE,
  TOOL_SUPERSEDE_FACT,
  ToolOutput,
  type ToolCall,
  type ToolResult,
} from "./definitions";
import { Session, type ExtractionSession } from "./session";

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function num(args: Record<string, unknown>, key: string): number | null {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arr(args: Record<string, unknown>, key: string): string[] | null {
  const value = args[key];
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}

function clampLimit(requested: number | null): number {
  if (requested === null || !Number.isFinite(requested) || requested <= 0) return DEFAULT_LIMIT;
  return Math.min(requested, MAX_LIMIT);
}

// Map a proposed entity type to a validation-ready EntityType (staged types
// have no id yet; a throwaway one is fine for validation).
function toAdHocEntityType(storyId: string, proposed: ProposedEntityType): EntityType {
  return {
    id: randomUUID(),
    storyId,
    name: proposed.name,
    pluralName: proposed.pluralName,
    baseKind: proposed.baseKind,
    description: proposed.description ?? null,
    attributeDefs: proposed.attributeDefs.map(toAttributeDef),
    origin: "extracted",
    supersededBy: null,
    createdAt: new Date(),
  };
}

function toAttributeDef(def: ProposedEntityType["attributeDefs"][number]): AttributeDef {
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

// Mirrors AttributeDefSchema; returns human-readable corrective errors.
function validateAttributeDefs(defs: ProposedEntityType["attributeDefs"]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const def of defs) {
    key: {
      if (def.key.trim().length === 0 || def.label.trim().length === 0) {
        errors.push(`attribute def missing key or label`);
        break key;
      }
      if (seen.has(def.key)) errors.push(`duplicate attribute key "${def.key}"`);
      seen.add(def.key);
    }
    if (def.multi && !MULTI_ALLOWED_KINDS.includes(def.kind)) {
      errors.push(`attribute "${def.key}": kind "${def.kind}" does not support multi-valued`);
    }
    if (def.kind === "enum" && !def.enumValues?.length) {
      errors.push(`attribute "${def.key}": kind "enum" requires enumValues`);
    }
    if (def.kind !== "enum" && def.enumValues !== undefined) {
      errors.push(`attribute "${def.key}": enumValues is only allowed for kind "enum"`);
    }
    if (def.kind === "ref" && !def.refType) {
      errors.push(`attribute "${def.key}": kind "ref" requires refType`);
    }
    if (def.kind !== "ref" && def.refType !== undefined) {
      errors.push(`attribute "${def.key}": refType is only allowed for kind "ref"`);
    }
  }
  return errors;
}

interface ResolvedType {
  staged: boolean;
  entityType: EntityType;
}

async function getWorld(store: StoryWorldStore, storyId: string): Promise<StoryWorld | null> {
  return store.getWorld(storyId);
}

function resolveType(
  session: ExtractionSession,
  world: StoryWorld | null,
  typeName: string,
): ResolvedType | null {
  const key = Session.normName(typeName);
  const staged = session.entityTypes.find((type) => Session.normName(type.name) === key);
  if (staged) return { staged: true, entityType: toAdHocEntityType(session.storyId, staged) };
  const registry = world?.entityTypes.find((type) => Session.normName(type.name) === key);
  if (registry) return { staged: false, entityType: registry };
  return null;
}

function entityNameExists(session: ExtractionSession, world: StoryWorld | null, name: string): boolean {
  const key = Session.normName(name);
  if (world?.entities.some((e) => Session.normName(e.name) === key || e.aliases.some((a) => Session.normName(a) === key))) {
    return true;
  }
  return session.entities.some((e) => Session.normName(e.name) === key);
}

function sameClaim(
  a: { subject: string; predicate: string },
  b: { subject: string; predicate: string },
): boolean {
  return Session.normName(a.subject) === Session.normName(b.subject) && Session.normName(a.predicate) === Session.normName(b.predicate);
}

function objectsDiffer(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  return left !== right;
}

// ---- Read tools -----------------------------------------------------------

async function listEntityTypes(
  store: StoryWorldStore,
  session: ExtractionSession,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const registry = (world?.entityTypes ?? []).map((type) => ({
    id: type.id,
    name: type.name,
    pluralName: type.pluralName,
    baseKind: type.baseKind,
    description: type.description,
    attributeDefs: type.attributeDefs,
    staged: false,
  }));
  const staged = session.entityTypes.map((type) => ({
    id: null,
    name: type.name,
    pluralName: type.pluralName,
    baseKind: type.baseKind,
    description: type.description,
    attributeDefs: type.attributeDefs,
    staged: true,
  }));
  return ToolOutput.ok(`entity types found: ${registry.length + staged.length}`, {
    entityTypes: [...registry, ...staged],
  });
}

function toEntityRow(
  id: string,
  name: string,
  aliases: string[],
  entityTypeId: string,
  entityTypeName: string,
  attributes: Record<string, unknown>,
  staged: boolean,
): Record<string, unknown> {
  return { id, name, aliases, entityTypeId, entityTypeName, attributes, staged };
}

async function getEntities(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const entityTypeId = str(args, "entityTypeId");
  if (!entityTypeId) return ToolOutput.err('get_entities: missing "entityTypeId"');
  if (session.counters.fetchedEntities >= MAX_FETCHES) {
    return ToolOutput.err(`get_entities: entity fetch budget exhausted (${MAX_FETCHES})`);
  }

  const limit = clampLimit(num(args, "limit"));
  const offset = Math.max(0, num(args, "offset") ?? 0);
  const query = str(args, "query");

  const registryType = world?.entityTypes.find((type) => type.id === entityTypeId) ?? null;
  const registry = registryType ? await store.listEntities(session.storyId, entityTypeId) : [];
  const staged = registryType
    ? session.entities.filter((entity) => Session.normName(entity.entityTypeName) === Session.normName(registryType.name))
    : [];
  const registryTypeName = registryType?.name ?? entityTypeId;

  let rows: Record<string, unknown>[] = [];
  for (const entity of registry) {
    rows.push(
      toEntityRow(
        entity.id,
        entity.name,
        entity.aliases,
        entity.entityTypeId,
        registryTypeName,
        entity.attributes,
        false,
      ),
    );
  }
  for (const entity of staged) {
    rows.push(
      toEntityRow(
        Session.stagedEntityIdFor(session, entity.name),
        entity.name,
        entity.aliases,
        "staged",
        entity.entityTypeName,
        entity.attributes,
        true,
      ),
    );
  }

  if (query) {
    const needle = Session.normName(query);
    rows = rows.filter(
      (row) =>
        Session.normName(String(row.name)).includes(needle) ||
        (row.aliases as string[]).some((alias) => Session.normName(alias).includes(needle)),
    );
  }

  rows = rows.slice(offset, offset + limit);

  const remaining = MAX_FETCHES - session.counters.fetchedEntities;
  if (rows.length > remaining) rows = rows.slice(0, remaining);
  session.counters.fetchedEntities += rows.length;

  return ToolOutput.ok(
    `matched ${rows.length} entities of type "${registryTypeName}" (budget ${session.counters.fetchedEntities}/${MAX_FETCHES})`,
    { total: rows.length, limit, offset, entities: rows },
  );
}

async function getEntity(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const entityId = str(args, "entityId");
  if (!entityId) return ToolOutput.err('get_entity: missing "entityId"');
  if (session.counters.fetchedEntities >= MAX_FETCHES) {
    return ToolOutput.err(`get_entity: entity fetch budget exhausted (${MAX_FETCHES})`);
  }

  const staged = Session.stagedEntityNameById(session, entityId);
  if (staged) {
    const entity = session.entities.find((e) => Session.normName(e.name) === Session.normName(staged));
    if (!entity) return ToolOutput.err(`get_entity: staged entity "${staged}" not found`);
    session.counters.fetchedEntities += 1;
    return ToolOutput.ok(`staged entity "${entity.name}" (not yet committed)`, {
      id: entityId,
      name: entity.name,
      aliases: entity.aliases,
      entityTypeId: "staged",
      entityTypeName: entity.entityTypeName,
      attributes: entity.attributes,
      staged: true,
    });
  }

  const entity = await store.getEntity(session.storyId, entityId);
  if (!entity) return ToolOutput.err(`get_entity: unknown entity id "${entityId}"`);
  session.counters.fetchedEntities += 1;
  const type = world?.entityTypes.find((t) => t.id === entity.entityTypeId);
  return ToolOutput.ok(`entity "${entity.name}"`, {
    id: entity.id,
    name: entity.name,
    aliases: entity.aliases,
    entityTypeId: entity.entityTypeId,
    entityTypeName: type?.name ?? entity.entityTypeId,
    attributes: entity.attributes,
    media: entity.media,
    staged: false,
  });
}

async function queryEvents(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const entityId = str(args, "entityId") ?? undefined;
  const events = await store.queryEvents(session.storyId, { entityId, limit: 20, offset: 0 });
  return ToolOutput.ok(`events found: ${events.length} (most recent 20)`, {
    events: events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      when: event.when,
      participants: event.participants,
      confidence: event.confidence,
    })),
  });
}

// ---- Staged write tools ---------------------------------------------------

async function stageCreateEntityType(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const name = str(args, "name");
  const pluralName = str(args, "pluralName");
  const baseKind = str(args, "baseKind");
  if (!name || !pluralName || !baseKind) {
    return ToolOutput.err('stage_create_entity_type: required "name", "pluralName", "baseKind"');
  }
  if (!(baseKind in BASE_KIND_CATALOG)) {
    return ToolOutput.err(
      `stage_create_entity_type: baseKind "${baseKind}" is not valid (expected character, place, physical or abstract)`,
    );
  }

  const duplicates =
    session.entityTypes.some((type) => Session.normName(type.name) === Session.normName(name)) ||
    world?.entityTypes.some((type) => Session.normName(type.name) === Session.normName(name)) === true;
  if (duplicates) {
    return ToolOutput.err(
      `stage_create_entity_type: entity type "${name}" already exists (registry or staged); update it instead`,
    );
  }

  const rawDefs = args["attributeDefs"];
  const attributeDefs: ProposedEntityType["attributeDefs"] = Array.isArray(rawDefs)
    ? (rawDefs.filter(
        (item): item is ProposedEntityType["attributeDefs"][number] =>
          typeof item === "object" && item !== null && "key" in item && "label" in item && "kind" in item,
      ) as ProposedEntityType["attributeDefs"])
    : [];
  const defErrors = validateAttributeDefs(attributeDefs);
  if (defErrors.length > 0) {
    return ToolOutput.err(`stage_create_entity_type: invalid attribute defs: ${defErrors.join("; ")}`);
  }

  session.entityTypes.push({
    name,
    pluralName,
    baseKind: baseKind as ProposedEntityType["baseKind"],
    description: (str(args, "description") ?? null),
    attributeDefs,
  });
  return ToolOutput.ok(`staged entity type "${name}" (baseKind ${baseKind})`);
}

async function stageCreateEntity(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const typeName = str(args, "entityTypeName");
  const name = str(args, "name");
  if (!typeName || !name) {
    return ToolOutput.err('stage_create_entity: required "entityTypeName" and "name"');
  }

  const resolved = resolveType(session, world, typeName);
  if (!resolved) {
    return ToolOutput.err(
      `stage_create_entity: unknown entity type "${typeName}"; stage it with stage_create_entity_type or reuse a listed type`,
    );
  }

  if (entityNameExists(session, world, name)) {
    return ToolOutput.err(
      `stage_create_entity: entity "${name}" already exists (registry or staged); update it with stage_update_entity instead`,
    );
  }

  // Also guard against alias conflicts: if any proposed alias matches an
  // existing entity's name or alias, this is the same entity — update instead.
  const proposedAliases = arr(args, "aliases") ?? [];
  for (const alias of proposedAliases) {
    if (entityNameExists(session, world, alias)) {
      return ToolOutput.err(
        `stage_create_entity: alias "${alias}" already matches an existing entity; use stage_update_entity on that entity to add the name "${name}" as an alias instead`,
      );
    }
  }

  const rawAttributes = args["attributes"];
  const attributes: Record<string, unknown> =
    typeof rawAttributes === "object" && rawAttributes !== null && !Array.isArray(rawAttributes)
      ? (rawAttributes as Record<string, unknown>)
      : {};

  const validation = validateAttributes(
    resolved.entityType,
    attributes as Record<string, AttributeValue>,
  );
  if (!validation.ok) {
    return ToolOutput.err(
      `stage_create_entity: "${name}" attributes are invalid: ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const stagedId = Session.stagedEntityIdFor(session, name);
  session.entities.push({
    entityTypeName: resolved.entityType.name,
    name,
    aliases: arr(args, "aliases") ?? [],
    attributes: validation.attributes,
  });

  return ToolOutput.ok(`staged entity "${name}" of type "${resolved.entityType.name}"`, {
    stagedEntityId: stagedId,
  });
}

async function stageUpdateEntity(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const entityId = str(args, "entityId");
  if (!entityId) return ToolOutput.err('stage_update_entity: missing "entityId"');

  const rawAttributes = args["attributes"];
  const attributes: Record<string, unknown> | undefined =
    typeof rawAttributes === "object" && rawAttributes !== null && !Array.isArray(rawAttributes)
      ? (rawAttributes as Record<string, unknown>)
      : undefined;
  const aliases = arr(args, "aliases") ?? undefined;
  if (attributes === undefined && aliases === undefined) {
    return ToolOutput.err("stage_update_entity: nothing to update (provide attributes and/or aliases)");
  }

  // Resolve the base entity across the world snapshot or staged creates.
  const worldEntity = world?.entities.find((e) => e.id === entityId) ?? null;
  const staged = worldEntity ? null : Session.stagedEntityNameById(session, entityId);
  const stagedProposed = staged ? session.entities.find((e) => Session.normName(e.name) === Session.normName(staged)) : null;
  if (!worldEntity && !stagedProposed) {
    return ToolOutput.err(`stage_update_entity: entity "${entityId}" not found (registry or staged)`);
  }

  const typeName = worldEntity
    ? (world?.entityTypes.find((t) => t.id === worldEntity.entityTypeId)?.name ?? null)
    : stagedProposed!.entityTypeName;
  const baseId = worldEntity ? worldEntity.id : Session.stagedEntityIdFor(session, stagedProposed!.name);
  if (!typeName) {
    return ToolOutput.err(`stage_update_entity: cannot resolve type for entity "${entityId}"`);
  }
  const type = resolveType(session, world, typeName);
  if (!type) return ToolOutput.err(`stage_update_entity: unknown type "${typeName}"`);

  const merged = {
    attributes: {
      ...(worldEntity?.attributes ?? stagedProposed!.attributes),
      ...(attributes ?? {}),
    },
    aliases: aliases ?? worldEntity?.aliases ?? stagedProposed!.aliases,
  };

  const validation = validateAttributes(
    type.entityType,
    merged.attributes as Record<string, AttributeValue>,
  );
  if (!validation.ok) {
    return ToolOutput.err(
      `stage_update_entity: "${worldEntity?.name ?? stagedProposed!.name}" attributes are invalid after update: ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  session.updates.set(baseId, {
    attributes: attributes as Record<string, AttributeValue> | undefined,
    aliases,
  });
  return ToolOutput.ok(`staged update for entity "${worldEntity?.name ?? stagedProposed!.name}"`);
}

async function stageCreateEvent(
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const title = str(args, "title");
  if (!title) return ToolOutput.err("stage_create_event: required \"title\"");
  const confidence = confidenceValue(args);
  if (!confidence) return ToolOutput.err('stage_create_event: invalid "confidence"');

  const rawWhen = args["when"];
  const when =
    typeof rawWhen === "object" &&
    rawWhen !== null &&
    !Array.isArray(rawWhen) &&
    typeof (rawWhen as { raw?: unknown }).raw === "string"
      ? (rawWhen as { raw: string; normalized?: { chapter?: string; day?: string; hour?: string; order: number } })
      : null;

  const sceneIdArg = typeof args["sceneId"] === "string" ? args["sceneId"] : null;

  session.events.push({
    title,
    description: str(args, "description") ?? null,
    settingName: str(args, "settingName"),
    when,
    motivation: str(args, "motivation") ?? null,
    consequences: arr(args, "consequences") ?? [],
    knowledgeGained: arr(args, "knowledgeGained") ?? [],
    knowledgeConcealed: arr(args, "knowledgeConcealed") ?? [],
    participantNames: arr(args, "participantNames") ?? [],
    involvedObjectNames: arr(args, "involvedObjectNames") ?? [],
    confidence,
    sceneId: sceneIdArg,
  });
  return ToolOutput.ok(`staged event "${title}"`);
}

async function stageCreateFact(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const subject = str(args, "subject");
  const predicate = str(args, "predicate");
  if (!subject || !predicate) {
    return ToolOutput.err('stage_create_fact: required "subject" and "predicate"');
  }
  const confidence = confidenceValue(args);
  if (!confidence) return ToolOutput.err('stage_create_fact: invalid "confidence"');
  const objectValue = str(args, "objectValue");

  const claim = { subject, predicate, objectValue, confidence };

  // Duplicate guard: identical active claim already present.
  const active = listActiveFacts(world?.facts ?? []);
  const existingActive = active.find(
    (fact) => sameClaim(fact, claim) && !objectsDiffer(fact.objectValue, claim.objectValue),
  );
  if (existingActive) {
    return ToolOutput.err(
      `stage_create_fact: identical claim "${subject} ${predicate}" is already a recorded fact; no need to re-stage`,
    );
  }
  const stagedDuplicate = session.facts.find(
    (fact) => sameClaim(fact, claim) && !objectsDiffer(fact.objectValue, claim.objectValue),
  );
  if (stagedDuplicate) {
    return ToolOutput.ok(`claim "${subject} ${predicate}" is already staged in this session`);
  }

  // Contradiction guard: active fact with same subject+predicate but a
  // different object value. Surfaced for the agent; the conflict header is
  // carried into the commit so applyCommit can supersede on finish.
  const conflicting = active.find(
    (fact) => sameClaim(fact, claim) && objectsDiffer(fact.objectValue, claim.objectValue),
  );
  if (conflicting) {
    const description = (fact: typeof claim) =>
      `${fact.subject} ${fact.predicate}${fact.objectValue ? ` "${fact.objectValue}"` : ""}`;
    const existingContradiction = session.contradictions.some(
      (c) => c.existingFactId === conflicting.id,
    );
    if (!existingContradiction) {
      session.contradictions.push({
        existingFactId: conflicting.id,
        existingFactDescription: description(conflicting),
        newFactDescription: description(claim),
        recommendedAction: "supersede",
      });
      session.supersedeFactIds.push(conflicting.id);
    }
    session.facts.push(claim);
    return ToolOutput.ok(
      `staged but FLAGGED: this claim contradicts existing fact "${conflicting.id}" (${description(conflicting)}). ` +
        `The old fact will be superseded on commit; use supersede_fact if it should not be kept`,
      { contradiction: description(conflicting) },
    );
  }

  session.facts.push(claim);
  return ToolOutput.ok(`staged fact "${subject} ${predicate}"`);
}

async function stageCreateRelationship(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const fromEntityName = str(args, "fromEntityName");
  const toEntityName = str(args, "toEntityName");
  const kind = str(args, "kind");
  if (!fromEntityName || !toEntityName || !kind) {
    return ToolOutput.err('stage_create_relationship: required "fromEntityName", "toEntityName", "kind"');
  }
  const confidence = confidenceValue(args);
  if (!confidence) return ToolOutput.err('stage_create_relationship: invalid "confidence"');

  for (const name of [fromEntityName, toEntityName]) {
    if (!entityNameExists(session, world, name)) {
      return ToolOutput.err(
        `stage_create_relationship: entity "${name}" is not known; create it with stage_create_entity or check the spelling`,
      );
    }
  }

  session.relationships.push({
    fromEntityName,
    toEntityName,
    kind,
    details: str(args, "details") ?? null,
    confidence,
  });
  return ToolOutput.ok(`staged relationship "${fromEntityName} ${kind} ${toEntityName}"`);
}

async function stageUpdateKnowledge(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const subjectEntityName = str(args, "subjectEntityName");
  const knowledgeText = str(args, "knowledgeText");
  if (!subjectEntityName || !knowledgeText) {
    return ToolOutput.err('stage_update_knowledge: required "subjectEntityName" and "knowledgeText"');
  }
  if (!entityNameExists(session, world, subjectEntityName)) {
    return ToolOutput.err(
      `stage_update_knowledge: entity "${subjectEntityName}" is not known; create it first or check the spelling`,
    );
  }
  const parsedStatus = KnowledgeStatusSchema.safeParse(str(args, "status"));
  if (!parsedStatus.success) {
    return ToolOutput.err('stage_update_knowledge: invalid "status" (expected known, unknown, believed_true or believed_false)');
  }

  session.knowledge.push({
    subjectEntityName,
    knowledgeText,
    status: parsedStatus.data,
    learnedWhen: str(args, "learnedWhen") ?? null,
    learnedVia: str(args, "learnedVia") ?? null,
  });
  return ToolOutput.ok(`staged knowledge for "${subjectEntityName}"`);
}

async function stageResolveOpenQuestion(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const question = str(args, "question");
  if (!question) return ToolOutput.err('stage_resolve_open_question: required "question"');
  const unresolved = (world?.openQuestions ?? []).filter(
    (entry) => !entry.isResolved && Session.normName(entry.question) === Session.normName(question),
  );
  if (unresolved.length === 0) {
    return ToolOutput.err(
      `stage_resolve_open_question: no unresolved open question matching "${question}"; only resolve questions listed in the brief`,
    );
  }
  const id = unresolved[0].id;
  if (!session.resolvedOpenQuestionIds.includes(id)) {
    session.resolvedOpenQuestionIds.push(id);
  }
  return ToolOutput.ok(`will resolve open question "${question}" on commit`);
}

async function supersedeFact(
  store: StoryWorldStore,
  session: ExtractionSession,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const world = await getWorld(store, session.storyId);
  const factId = str(args, "factId");
  if (!factId) return ToolOutput.err('supersede_fact: missing "factId"');
  const fact = (world?.facts ?? []).find((candidate) => candidate.id === factId);
  if (!fact) return ToolOutput.err(`supersede_fact: unknown fact id "${factId}"`);
  if (fact.supersededBy !== null) {
    return ToolOutput.err(`supersede_fact: fact "${factId}" is already superseded`);
  }
  if (!session.supersedeFactIds.includes(factId)) session.supersedeFactIds.push(factId);
  return ToolOutput.ok(`will supersede fact "${fact.subject} ${fact.predicate}" on commit`);
}

async function finish(session: ExtractionSession): Promise<ToolResult> {
  if (!Session.hasStagedChanges(session)) {
    return ToolOutput.err(
      "finish() rejected: no staged changes yet. Stage entity types, entities, events, facts, relationships, or knowledge before finishing",
    );
  }
  return ToolOutput.ok("extraction complete; staged changes will be committed", Session.summarize(session));
}

// T5.2 — executes one tool call against the current staged world. All functions
// are static: reads/staged-writes take the store explicitly and nothing holds
// state across calls. Budget enforcement happens here and in the loop (T5.4).
export class StoryToolExecutor {
  static async execute(
    store: StoryWorldStore,
    session: ExtractionSession,
    call: ToolCall,
  ): Promise<ToolResult> {
    if (session.counters.toolCalls >= MAX_TOOL_CALLS) {
      return ToolOutput.err(`tool-call budget exhausted (${MAX_TOOL_CALLS}); extraction stops here`);
    }
    session.counters.toolCalls += 1;
    const args = call.arguments ?? {};

    switch (call.name) {
      case TOOL_LIST_ENTITY_TYPES:
        return listEntityTypes(store, session);
      case TOOL_GET_ENTITIES:
        return getEntities(store, session, args);
      case TOOL_GET_ENTITY:
        return getEntity(store, session, args);
      case TOOL_QUERY_EVENTS:
        return queryEvents(store, session, args);
      case TOOL_STAGE_CREATE_ENTITY_TYPE:
        return stageCreateEntityType(store, session, args);
      case TOOL_STAGE_CREATE_ENTITY:
        return stageCreateEntity(store, session, args);
      case TOOL_STAGE_UPDATE_ENTITY:
        return stageUpdateEntity(store, session, args);
      case TOOL_STAGE_CREATE_EVENT:
        return stageCreateEvent(session, args);
      case TOOL_STAGE_CREATE_FACT:
        return stageCreateFact(store, session, args);
      case TOOL_STAGE_CREATE_RELATIONSHIP:
        return stageCreateRelationship(store, session, args);
      case TOOL_STAGE_UPDATE_KNOWLEDGE:
        return stageUpdateKnowledge(store, session, args);
      case TOOL_STAGE_RESOLVE_OPEN_QUESTION:
        return stageResolveOpenQuestion(store, session, args);
      case TOOL_SUPERSEDE_FACT:
        return supersedeFact(store, session, args);
      case TOOL_FINISH:
        return finish(session);
      default:
        return ToolOutput.err(`unknown tool "${call.name}"`);
    }
  }
}

function confidenceValue(args: Record<string, unknown>): "explicit" | "implied" | "inferred" | "unknown" | null {
  const value = args["confidence"];
  if (value === undefined || value === null) return "implied";
  if (value === "explicit" || value === "implied" || value === "inferred" || value === "unknown") {
    return value;
  }
  return null;
}