import type { AttributeValue } from "@/domain/entity-types";
import type { Contradiction } from "@/domain/proposals";
import type {
  ProposedEntity,
  ProposedEntityType,
  ProposedEvent,
  ProposedFact,
  ProposedKnowledge,
  ProposedRelationship,
} from "@/domain/proposals";

export interface StagedEntityUpdate {
  attributes?: Record<string, AttributeValue>;
  aliases?: string[];
}

// Domain Contradiction plus the store id the claim conflicts with, so the
// commit builder can express it as a supersede when the agent agrees.
export interface SessionContradiction extends Contradiction {
  existingFactId: string | null;
}

// Mutable session for one transcript chunk. Writes are staged here and only
// materialize as a Commit when the agent calls finish (or the loop ends).
export interface ExtractionSession {
  storyId: string;
  entityTypes: ProposedEntityType[];
  entities: ProposedEntity[];
  // Stable synthetic ids for staged entity creates (normName -> id), so the
  // model can reference them (get_entity / stage_update_entity / supersede)
  // before they are assigned real UUIDs at commit time.
  entityIds: Map<string, string>;
  updates: Map<string, StagedEntityUpdate>;
  events: ProposedEvent[];
  facts: ProposedFact[];
  relationships: ProposedRelationship[];
  knowledge: ProposedKnowledge[];
  resolvedOpenQuestionIds: string[];
  supersedeFactIds: string[];
  contradictions: SessionContradiction[];
  counters: { toolCalls: number; fetchedEntities: number };
}

// Factory + helpers for one extraction session (T5.2). All functions are
// static: nothing here holds state across calls.
export class Session {
  static create(storyId: string): ExtractionSession {
    return {
      storyId,
      entityTypes: [],
      entities: [],
      entityIds: new Map(),
      updates: new Map(),
      events: [],
      facts: [],
      relationships: [],
      knowledge: [],
      resolvedOpenQuestionIds: [],
      supersedeFactIds: [],
      contradictions: [],
      counters: { toolCalls: 0, fetchedEntities: 0 },
    };
  }

  // Reverse lookup from a synthetic staged id back to its entity name.
  static stagedEntityNameById(
    session: ExtractionSession,
    id: string,
  ): string | null {
    for (const [name, stagedId] of session.entityIds) {
      if (stagedId === id) return name;
    }
    return null;
  }

  static stagedEntityIdFor(session: ExtractionSession, name: string): string {
    const key = Session.normName(name);
    const existing = session.entityIds.get(key);
    if (existing) return existing;
    const id = `staged-${session.entityIds.size + 1}-${key.replace(/\s+/g, "-").slice(0, 24)}`;
    session.entityIds.set(key, id);
    return id;
  }

  static hasStagedChanges(session: ExtractionSession): boolean {
    return (
      session.entityTypes.length > 0 ||
      session.entities.length > 0 ||
      session.updates.size > 0 ||
      session.events.length > 0 ||
      session.facts.length > 0 ||
      session.relationships.length > 0 ||
      session.knowledge.length > 0 ||
      session.resolvedOpenQuestionIds.length > 0 ||
      session.supersedeFactIds.length > 0 ||
      session.contradictions.length > 0
    );
  }

  // Case-insensitive name comparison used everywhere the agent matches names.
  static normName(name: string): string {
    return name.trim().toLowerCase();
  }

  static summarize(session: ExtractionSession): Record<string, number> {
    return {
      entityTypes: session.entityTypes.length,
      entities: session.entities.length,
      entityUpdates: session.updates.size,
      events: session.events.length,
      facts: session.facts.length,
      relationships: session.relationships.length,
      knowledge: session.knowledge.length,
      resolvedOpenQuestions: session.resolvedOpenQuestionIds.length,
      supersededFacts: session.supersedeFactIds.length,
      contradictions: session.contradictions.length,
    };
  }
}