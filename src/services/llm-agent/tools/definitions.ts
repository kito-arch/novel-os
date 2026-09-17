import { z } from "zod";

// Budgets enforced by the extraction agent loop (T5.2/T5.4): a single transcript
// chunk may issue at most MAX_TOOL_CALLS tool calls and fetch at most
// MAX_FETCHES entities. get_entities clamps to [1, MAX_LIMIT] per call.
export const MAX_TOOL_CALLS = 40;
export const MAX_FETCHES = 200;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// Read tools: hit the store directly, never mutate the session.
export const TOOL_LIST_ENTITY_TYPES = "list_entity_types";
export const TOOL_GET_ENTITIES = "get_entities";
export const TOOL_GET_ENTITY = "get_entity";
export const TOOL_QUERY_EVENTS = "query_events";

// Staged writes: nothing persists until finish/commit.
export const TOOL_STAGE_CREATE_ENTITY_TYPE = "stage_create_entity_type";
export const TOOL_STAGE_CREATE_ENTITY = "stage_create_entity";
export const TOOL_STAGE_UPDATE_ENTITY = "stage_update_entity";
export const TOOL_STAGE_CREATE_EVENT = "stage_create_event";
export const TOOL_STAGE_CREATE_FACT = "stage_create_fact";
export const TOOL_STAGE_CREATE_RELATIONSHIP = "stage_create_relationship";
export const TOOL_STAGE_UPDATE_KNOWLEDGE = "stage_update_knowledge";
export const TOOL_STAGE_RESOLVE_OPEN_QUESTION = "stage_resolve_open_question";

export const TOOL_SUPERSEDE_FACT = "supersede_fact";
export const TOOL_FINISH = "finish";

export const READ_TOOLS: readonly string[] = [
  TOOL_LIST_ENTITY_TYPES,
  TOOL_GET_ENTITIES,
  TOOL_GET_ENTITY,
  TOOL_QUERY_EVENTS,
];

export const STAGED_WRITE_TOOLS: readonly string[] = [
  TOOL_STAGE_CREATE_ENTITY_TYPE,
  TOOL_STAGE_CREATE_ENTITY,
  TOOL_STAGE_UPDATE_ENTITY,
  TOOL_STAGE_CREATE_EVENT,
  TOOL_STAGE_CREATE_FACT,
  TOOL_STAGE_CREATE_RELATIONSHIP,
  TOOL_STAGE_UPDATE_KNOWLEDGE,
  TOOL_STAGE_RESOLVE_OPEN_QUESTION,
];

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

// Constructors for ToolResult; used by the executor to reply to tool calls.
export class ToolOutput {
  static ok(message: string, data?: unknown): ToolResult {
    return { ok: true, message, data };
  }

  static err(message: string, data?: unknown): ToolResult {
    return { ok: false, message, data };
  }
}

// A tool call as received by the executor (the AI SDK hands the loop TypedToolCall
// parts; the SDK tool-set bridge maps them to this shape before executing).
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

const confidenceEnum = z.enum(["explicit", "implied", "inferred", "unknown"]);
const attributeKindEnum = z.enum(["text", "number", "boolean", "enum", "ref", "timeline"]);
const baseKindEnum = z.enum(["character", "place", "physical", "abstract"]);

const attributeDefSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    kind: attributeKindEnum,
    required: z.boolean().optional(),
    multi: z.boolean().optional(),
    enumValues: z.array(z.string()).optional(),
    refType: z.string().optional(),
  })
  .strict();

const attributeValuesSchema = z.record(z.string(), z.unknown());

// Per-tool input schemas. strict() keeps the JSON-Schema conversion at
// additionalProperties: false; describe() becomes the parameter description.
// These are the single source of truth for the AI SDK tools (zodSchema →
// inputSchema) and for any callers that validate arguments themselves.
export const STORY_TOOL_CATALOG: Record<StoryToolName, StoryToolDefinition> = {
  [TOOL_LIST_ENTITY_TYPES]: {
    description: "List the story's entity type registry, including just-staged types.",
    inputSchema: z
      .object({
        storyId: z.string().describe("Story the entity type registry belongs to."),
      })
      .strict(),
  },
  [TOOL_GET_ENTITIES]: {
    description: "Fetch entities of a registry entity type (bounded).",
    inputSchema: z
      .object({
        storyId: z.string().describe("Story the entities belong to."),
        entityTypeId: z
          .string()
          .describe("Entity type id from list_entity_types (registry types only)."),
        limit: z
          .number()
          .describe(`Number of entities to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`)
          .optional(),
        offset: z.number().describe("Pagination offset (default 0).").optional(),
        query: z
          .string()
          .describe("Optional case-insensitive substring match on entity name or aliases.")
          .optional(),
      })
      .strict(),
  },
  [TOOL_GET_ENTITY]: {
    description: "Fetch a single entity by id.",
    inputSchema: z
      .object({
        storyId: z.string().describe("Story the entity belongs to."),
        entityId: z.string().describe("Entity id from get_entities."),
      })
      .strict(),
  },
  [TOOL_QUERY_EVENTS]: {
    description: "Fetch recent story events, optionally for one entity.",
    inputSchema: z
      .object({
        storyId: z.string().describe("Story the events belong to."),
        entityId: z
          .string()
          .describe("Optional: only events that involve this entity (setting/participant/object).")
          .optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_CREATE_ENTITY_TYPE]: {
    description: "Stage a new dynamic entity type (nothing persists until finish).",
    inputSchema: z
      .object({
        name: z.string().describe('Singular type name, e.g. "starship".'),
        pluralName: z.string().describe('Plural type name, e.g. "starships".'),
        baseKind: baseKindEnum,
        description: z.string().nullable().describe("Optional.").optional(),
        attributeDefs: z
          .array(attributeDefSchema)
          .describe("Optional dynamic attribute definitions for this type.")
          .optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_CREATE_ENTITY]: {
    description: "Stage a new entity of an existing or just-staged type.",
    inputSchema: z
      .object({
        entityTypeName: z.string().describe("Name of the (possibly just-staged) entity type."),
        name: z.string().describe("Entity display name."),
        aliases: z.array(z.string()).optional(),
        attributes: attributeValuesSchema
          .describe("Values keyed by attribute def (validated against the type).")
          .optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_UPDATE_ENTITY]: {
    description: "Stage attribute/alias updates for an existing or staged entity.",
    inputSchema: z
      .object({
        entityId: z.string().describe("Id of an existing or staged entity."),
        attributes: attributeValuesSchema
          .describe("Optional attribute values to set/override (null clears).")
          .optional(),
        aliases: z.array(z.string()).optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_CREATE_EVENT]: {
    description: "Stage a story event.",
    inputSchema: z
      .object({
        title: z.string(),
        description: z.string().nullable().optional(),
        settingName: z.string().nullable().describe("Resolved to an entity by name.").optional(),
        when: z
          .object({
            raw: z.string(),
            normalized: z
              .object({
                chapter: z.string().optional(),
                day: z.string().optional(),
                hour: z.string().optional(),
                order: z.number().optional(),
              })
              .nullable()
              .optional(),
          })
          .strict()
          .nullable()
          .describe("Timeline ref: { raw } and optional normalized { chapter, day, hour, order }.")
          .optional(),
        motivation: z.string().nullable().optional(),
        consequences: z.array(z.string()).optional(),
        knowledgeGained: z.array(z.string()).optional(),
        knowledgeConcealed: z.array(z.string()).optional(),
        participantNames: z
          .array(z.string())
          .describe("Resolved to entities by name.")
          .optional(),
        involvedObjectNames: z.array(z.string()).optional(),
        confidence: confidenceEnum.optional(),
        sceneId: z
          .string()
          .uuid()
          .nullable()
          .describe("UUID of the scene this event occurs in; use the current scene id from the system prompt when narrating.")
          .optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_CREATE_FACT]: {
    description: "Stage a fact claim; conflicting claims surface a contradiction.",
    inputSchema: z
      .object({
        subject: z.string().describe('Claim subject, e.g. "The Relentless".'),
        predicate: z.string().describe('Claim predicate, e.g. "is captained by".'),
        objectValue: z.string().nullable().describe("Claim object, if any.").optional(),
        confidence: confidenceEnum.optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_CREATE_RELATIONSHIP]: {
    description: "Stage a relationship between two entities.",
    inputSchema: z
      .object({
        fromEntityName: z.string(),
        toEntityName: z.string(),
        kind: z.string().describe('Relationship kind, e.g. "rival_of".'),
        details: z.string().nullable().optional(),
        confidence: confidenceEnum.optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_UPDATE_KNOWLEDGE]: {
    description: "Stage a knowledge row for an entity.",
    inputSchema: z
      .object({
        subjectEntityName: z.string(),
        knowledgeText: z.string(),
        status: z.enum(["known", "unknown", "believed_true", "believed_false"]),
        learnedWhen: z.string().nullable().optional(),
        learnedVia: z.string().nullable().optional(),
      })
      .strict(),
  },
  [TOOL_STAGE_RESOLVE_OPEN_QUESTION]: {
    description: "Mark an open question from the brief as resolved by this dictation.",
    inputSchema: z
      .object({
        question: z
          .string()
          .describe("Exact text of an unresolved open question listed in the brief."),
      })
      .strict(),
  },
  [TOOL_SUPERSEDE_FACT]: {
    description: "Supersede an active fact (used to resolve contradictions).",
    inputSchema: z
      .object({
        factId: z.string().describe("Id of the active fact to supersede."),
      })
      .strict(),
  },
  [TOOL_FINISH]: {
    description:
      "End extraction: commits every staged change. Errors until at least one change is staged.",
    inputSchema: z.object({}).strict(),
  },
};

export type StoryToolName =
  | typeof TOOL_LIST_ENTITY_TYPES
  | typeof TOOL_GET_ENTITIES
  | typeof TOOL_GET_ENTITY
  | typeof TOOL_QUERY_EVENTS
  | typeof TOOL_STAGE_CREATE_ENTITY_TYPE
  | typeof TOOL_STAGE_CREATE_ENTITY
  | typeof TOOL_STAGE_UPDATE_ENTITY
  | typeof TOOL_STAGE_CREATE_EVENT
  | typeof TOOL_STAGE_CREATE_FACT
  | typeof TOOL_STAGE_CREATE_RELATIONSHIP
  | typeof TOOL_STAGE_UPDATE_KNOWLEDGE
  | typeof TOOL_STAGE_RESOLVE_OPEN_QUESTION
  | typeof TOOL_SUPERSEDE_FACT
  | typeof TOOL_FINISH;

export interface StoryToolDefinition {
  description: string;
  inputSchema: z.ZodTypeAny;
}