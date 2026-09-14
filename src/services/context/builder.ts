import type { StoryWorldStore } from "@/container/story-world-store";
import {
  listActiveFacts,
  type Entity,
  type EntityType,
  type StoryWorld,
  type AttributeValue,
} from "@/domain";
import { resolveMentions } from "./mention-parser";

export const MAX_MENTION_MATCHES = 10;
export const MAX_RELATIONSHIPS = 40;
export const MAX_RECENT_EVENTS = 10;
export const MAX_KNOWLEDGE_CLAIMS = 20;
export const MAX_OPEN_QUESTIONS = 10;
// Long attribute values get truncated so the rendered context stays bounded.
export const MAX_ATTRIBUTE_VALUE_CHARS = 200;
export const TOKEN_CAP = 4_000;

export interface ContextAttribute {
  key: string;
  label: string;
  value: AttributeValue;
}

export interface ContextEntityItem {
  id: string;
  name: string;
  typeName: string;
  typeBaseKind: string;
  aliases: string[];
  attributes: ContextAttribute[];
  hasMedia: boolean;
}

export interface ContextRelationship {
  fromEntityName: string;
  toEntityName: string;
  kind: string;
  details: string | null;
}

export interface ContextEvent {
  title: string;
  description: string | null;
  when: string | null;
  participants: string[];
  involvedObjects: string[];
  knowledgeGained: string[];
  knowledgeConcealed: string[];
}

export interface ContextKnowledge {
  subjectEntityName: string;
  knowledgeText: string;
  status: string;
  learnedWhen: string | null;
  learnedVia: string | null;
}

export interface ContextOpenQuestion {
  question: string;
  relatedEntityNames: string[];
}

export interface ContextPackage {
  storyId: string;
  storyTitle: string;
  revision: number;
  entities: ContextEntityItem[];
  relationships: ContextRelationship[];
  events: ContextEvent[];
  knowledge: ContextKnowledge[];
  openQuestions: ContextOpenQuestion[];
  facts: string[];
  tokenEstimate: number;
  truncated: boolean;
}

function truncateValue(value: AttributeValue): AttributeValue {
  if (typeof value !== "string" || value.length <= MAX_ATTRIBUTE_VALUE_CHARS) return value;
  return `${value.slice(0, MAX_ATTRIBUTE_VALUE_CHARS)}…`;
}

// T6.1 — registry-bounded context builder for the reasoning features. Mentions
// resolve against names + aliases across ALL entity types (≤ MAX_MENTION_MATCHES),
// attributes render per the owning type's attributeDefs (only declared keys),
// and relationships/events/knowledge/open questions attach only when they relate
// to a matched entity. Output stays bounded well under TOKEN_CAP: entity count,
// per-value string length, and every relationship/event/knowledge list are capped.
export async function buildContext(
  store: StoryWorldStore,
  storyId: string,
  mentions: string[],
): Promise<ContextPackage> {
  const world = await store.getWorld(storyId);
  if (!world) throw new Error(`story ${storyId} not found`);
  return buildContextFromWorld(world, mentions);
}

export function buildContextFromWorld(
  world: StoryWorld,
  mentions: string[],
): ContextPackage {
  const matched = resolveMentions(mentions, world.entities, MAX_MENTION_MATCHES);
  const matchedIds = new Set(matched.map((match) => match.entityId));
  const entityById = new Map(world.entities.map((entity) => [entity.id, entity]));
  const typeById = new Map(
    world.entityTypes.map((type) => [type.id, type]),
  );

  let truncated = matched.length < Math.min(Math.max(mentions.length, 0), MAX_MENTION_MATCHES);

  const entities: ContextEntityItem[] = matched.map((match) => {
    const entity = entityById.get(match.entityId)!;
    const type = typeById.get(entity.entityTypeId);
    const attributeDefs = type?.attributeDefs ?? [];
    const attributes: ContextAttribute[] = [];
    for (const def of attributeDefs) {
      const raw = entity.attributes[def.key];
      if (raw === undefined) continue;
      attributes.push({
        key: def.key,
        label: def.label,
        value: truncateValue(raw),
      });
    }
    return {
      id: entity.id,
      name: entity.name,
      typeName: type?.name ?? "_unknown_type",
      typeBaseKind: type?.baseKind ?? "abstract",
      aliases: entity.aliases,
      attributes,
      hasMedia: entity.media.length > 0,
    };
  });

  const relatedRelationships = world.relationships.filter(
    (relationship) =>
      relationship.supersededBy === null &&
      (matchedIds.has(relationship.fromEntityId) || matchedIds.has(relationship.toEntityId)),
  );
  if (relatedRelationships.length > MAX_RELATIONSHIPS) truncated = true;
  const relationships: ContextRelationship[] = relatedRelationships
    .slice(0, MAX_RELATIONSHIPS)
    .map((relationship) => ({
      fromEntityName: entityById.get(relationship.fromEntityId)?.name ?? relationship.fromEntityId,
      toEntityName: entityById.get(relationship.toEntityId)?.name ?? relationship.toEntityId,
      kind: relationship.kind,
      details: relationship.details,
    }));

  // Recent events: those the matched entities participate in / host as settings,
  // most recent first.
  const relatedEvents = world.events
    .filter(
      (event) =>
        (event.settingId !== null && matchedIds.has(event.settingId)) ||
        event.participants.some((id) => matchedIds.has(id)) ||
        event.involvedObjects.some((id) => matchedIds.has(id)),
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (relatedEvents.length > MAX_RECENT_EVENTS) truncated = true;
  const events: ContextEvent[] = relatedEvents.slice(0, MAX_RECENT_EVENTS).map((event) => ({
    title: event.title,
    description: event.description,
    when: event.when?.raw ?? null,
    participants: event.participants.map((id) => entityById.get(id)?.name ?? id),
    involvedObjects: event.involvedObjects.map((id) => entityById.get(id)?.name ?? id),
    knowledgeGained: event.knowledgeGained,
    knowledgeConcealed: event.knowledgeConcealed,
  }));

  const relatedKnowledge = world.knowledge.filter((row) => matchedIds.has(row.subjectEntityId));
  if (relatedKnowledge.length > MAX_KNOWLEDGE_CLAIMS) truncated = true;
  const knowledge: ContextKnowledge[] = relatedKnowledge
    .slice(0, MAX_KNOWLEDGE_CLAIMS)
    .map((row) => ({
      subjectEntityName: entityById.get(row.subjectEntityId)?.name ?? row.subjectEntityId,
      knowledgeText: row.knowledgeText,
      status: row.status,
      learnedWhen: row.learnedWhen,
      learnedVia: row.learnedVia,
    }));

  const openQuestions: ContextOpenQuestion[] = world.openQuestions
    .filter(
      (question) =>
        !question.isResolved && question.relatedEntityIds.some((id) => matchedIds.has(id)),
    )
    .slice(0, MAX_OPEN_QUESTIONS)
    .map((question) => ({
      question: question.question,
      relatedEntityNames: question.relatedEntityIds.map((id) => entityById.get(id)?.name ?? id),
    }));

  // Active facts mentioning a matched entity by name (facts carry subject/predicate
  // strings, not entity ids — resolve by name).
  const activeFacts = listActiveFacts(world.facts).filter((fact) =>
    matched.some((match) => fact.subject.toLowerCase() === match.name.toLowerCase()),
  );
  const facts: string[] = activeFacts.map((fact) =>
    `${fact.subject} ${fact.predicate}${
      fact.objectValue !== null ? ` ${JSON.stringify(fact.objectValue)}` : ""
    }`,
  );

  const pkg: ContextPackage = {
    storyId: world.id,
    storyTitle: world.title,
    revision: world.revision,
    entities,
    relationships,
    events,
    knowledge,
    openQuestions,
    facts,
    tokenEstimate: 0,
    truncated,
  };

  const rendered = renderContextPackage(pkg);
  pkg.tokenEstimate = Math.ceil(countWords(rendered) * 1.3);
  return pkg;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((part) => part.length > 0).length;
}

// Renders a ContextPackage as a compact prompt block shared by the reasoning
// tasks (ask/analyze). The token estimate is derived from this exact render.
export function renderContextPackage(pkg: ContextPackage): string {
  const lines: string[] = [`STORY: "${pkg.storyTitle}" (revision ${pkg.revision})`];

  for (const entity of pkg.entities) {
    lines.push(`## ${entity.name} — ${entity.typeName}`);
    if (entity.aliases.length > 0) lines.push(`aliases: ${entity.aliases.join(", ")}`);
    for (const attribute of entity.attributes) {
      const printed =
        Array.isArray(attribute.value)
          ? attribute.value.join(", ")
          : attribute.value === null
            ? "null"
            : String(attribute.value);
      lines.push(`- ${attribute.label}: ${printed}`);
    }
    if (entity.hasMedia) lines.push("- (has media)");
  }

  if (pkg.relationships.length > 0) {
    lines.push("## RELATIONSHIPS");
    for (const relationship of pkg.relationships) {
      const suffix = relationship.details ? ` (${relationship.details})` : "";
      lines.push(
        `- ${relationship.fromEntityName} —${relationship.kind}→ ${relationship.toEntityName}${suffix}`,
      );
    }
  }

  if (pkg.events.length > 0) {
    lines.push("## RECENT EVENTS");
    for (const event of pkg.events) {
      const when = event.when ? ` [${event.when}]` : "";
      const description = event.description ? ` ${event.description}` : "";
      lines.push(`- ${event.title}${when}:${description}`);
      if (event.participants.length > 0) {
        lines.push(`  participants: ${event.participants.join(", ")}`);
      }
    }
  }

  if (pkg.facts.length > 0) {
    lines.push("## FACTS");
    for (const fact of pkg.facts) lines.push(`- ${fact}`);
  }

  if (pkg.knowledge.length > 0) {
    lines.push("## KNOWLEDGE");
    for (const claim of pkg.knowledge) {
      lines.push(
        `- ${claim.subjectEntityName} ${claim.status} "${claim.knowledgeText}"${
          claim.learnedWhen ? ` (when: ${claim.learnedWhen})` : ""
        }`,
      );
    }
  }

  if (pkg.openQuestions.length > 0) {
    lines.push("## OPEN QUESTIONS");
    for (const question of pkg.openQuestions) {
      const related = question.relatedEntityNames.length
        ? ` [${question.relatedEntityNames.join(", ")}]`
        : "";
      lines.push(`- ${question.question}${related}`);
    }
  }

  return lines.join("\n");
}

export type { Entity, EntityType, StoryWorld };