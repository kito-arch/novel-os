import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TimelineRef } from "../src/domain/events";
import type { AttributeDef, AttributeValue } from "../src/domain/entity-types";

export const confidenceEnum = pgEnum("confidence", [
  "explicit",
  "implied",
  "inferred",
  "unknown",
]);
export const knowledgeStatusEnum = pgEnum("knowledge_status", [
  "known",
  "unknown",
  "believed_true",
  "believed_false",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const plotThreadStatusEnum = pgEnum("plot_thread_status", [
  "introduced",
  "active",
  "resolved",
  "abandoned",
]);
export const contradictionActionEnum = pgEnum("contradiction_action", [
  "supersede",
  "flag_soft",
  "flag_hard",
  "ignore",
]);

// Every world-building table carries a `revision` column: the story commit
// revision that introduced the row. `StoryWorldStore.byRevision(N)` filters
// on `revision <= N`, so per-commit snapshots are reconstructible without an
// explicit event-store log. Entity updates amend their row in place and keep
// the introducing revision.
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    synopsis: text("synopsis"),
    ownerId: text("owner_id").notNull(),
    storyType: text("story_type"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

export const dictations = pgTable(
  "dictations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    audioUrl: text("audio_url"),
    providerJobId: text("provider_job_id"),
    transcript: text("transcript"),
    wordCount: integer("word_count"),
    durationSeconds: real("duration_seconds"),
    status: jobStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [
    uniqueIndex("dictations_provider_job_id_idx").on(table.providerJobId),
  ],
);

export const entityTypes = pgTable(
  "entity_types",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pluralName: text("plural_name").notNull(),
    description: text("description"),
    baseKind: text("base_kind").notNull(),
    attributeDefs: jsonb("attribute_defs").$type<AttributeDef[]>().default([]),
    origin: text("origin").notNull(),
    supersededBy: uuid("superseded_by"),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entity_types_story_name_idx").on(table.storyId, table.name),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    entityTypeId: uuid("entity_type_id")
      .notNull()
      .references(() => entityTypes.id),
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().default([]),
    attributes: jsonb("attributes").$type<Record<string, AttributeValue>>().default({}),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entities_story_name_idx").on(table.storyId, table.name),
  ],
);

export const media = pgTable("media", {
  id: uuid("id").defaultRandom().primaryKey(),
  entityId: uuid("entity_id")
    .notNull()
    .references(() => entities.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  role: text("role").notNull(),
  caption: text("caption"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const facts = pgTable("facts", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  entityId: uuid("entity_id").references(() => entities.id),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  objectValue: text("object_value"),
  confidence: confidenceEnum("confidence").notNull(),
  // Provenance dictation ids are not FK-constrained: the dictation webhook may
  // arrive after the extraction that references it, and StoryWorldStore tests
  // use arbitrary (uninserted) dictation ids.
  provenanceDictationId: uuid("provenance_dictation_id"),
  provenanceText: text("provenance_text"),
  supersededBy: uuid("superseded_by"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  settingId: uuid("setting_id").references(() => entities.id),
  whenRaw: text("when_raw"),
  whenNormalized: jsonb("when_normalized").$type<NonNullable<TimelineRef["normalized"]>>(),
  motivation: text("motivation"),
  consequences: jsonb("consequences").$type<string[]>().default([]),
  knowledgeGained: jsonb("knowledge_gained").$type<string[]>().default([]),
  knowledgeConcealed: jsonb("knowledge_concealed").$type<string[]>().default([]),
  participants: jsonb("participants").$type<string[]>().default([]),
  involvedObjects: jsonb("involved_objects").$type<string[]>().default([]),
  confidence: confidenceEnum("confidence").notNull(),
  provenanceDictationId: uuid("provenance_dictation_id"),
  provenanceText: text("provenance_text"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const relationships = pgTable("relationships", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  fromEntityId: uuid("from_entity_id")
    .notNull()
    .references(() => entities.id),
  toEntityId: uuid("to_entity_id")
    .notNull()
    .references(() => entities.id),
  kind: text("kind").notNull(),
  details: text("details"),
  confidence: confidenceEnum("confidence").notNull(),
  provenanceDictationId: uuid("provenance_dictation_id"),
  provenanceText: text("provenance_text"),
  supersededBy: uuid("superseded_by"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const entityKnowledge = pgTable("entity_knowledge", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  subjectEntityId: uuid("subject_entity_id")
    .notNull()
    .references(() => entities.id),
  factId: uuid("fact_id").references(() => facts.id),
  knowledgeText: text("knowledge_text").notNull(),
  status: knowledgeStatusEnum("status").notNull(),
  learnedWhen: text("learned_when"),
  learnedVia: text("learned_via"),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  title: text("title"),
  settingId: uuid("setting_id").references(() => entities.id),
  whenRaw: text("when_raw"),
  whenNormalized: jsonb("when_normalized").$type<NonNullable<TimelineRef["normalized"]>>(),
  summary: text("summary"),
  chapterNumber: integer("chapter_number"),
  eventIds: jsonb("event_ids").$type<string[]>().default([]),
  participantIds: jsonb("participant_ids").$type<string[]>().default([]),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const plotThreads = pgTable("plot_threads", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: plotThreadStatusEnum("status").default("introduced").notNull(),
  introducedInSceneId: uuid("introduced_in_scene_id").references(() => scenes.id),
  lastMentionedInSceneId: uuid("last_mentioned_in_scene_id").references(() => scenes.id),
  relatedEntityIds: jsonb("related_entity_ids").$type<string[]>().default([]),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const openQuestions = pgTable("open_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  relatedEntityIds: jsonb("related_entity_ids").$type<string[]>().default([]),
  introducedInDictationId: uuid("introduced_in_dictation_id"),
  resolvedInDictationId: uuid("resolved_in_dictation_id"),
  isResolved: boolean("is_resolved").default(false).notNull(),
  revision: integer("revision").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const contradictions = pgTable("contradictions", {
  id: uuid("id").defaultRandom().primaryKey(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id, { onDelete: "cascade" }),
  existingFactId: uuid("existing_fact_id").references(() => facts.id),
  newFactDescription: text("new_fact_description").notNull(),
  existingFactDescription: text("existing_fact_description").notNull(),
  action: contradictionActionEnum("action"),
  resolved: boolean("resolved").default(false),
  resolvedByOwnerId: text("resolved_by_owner_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const processingJobs = pgTable("processing_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  dictationId: uuid("dictation_id")
    .notNull()
    .references(() => dictations.id),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  status: jobStatusEnum("status").default("pending").notNull(),
  tier: text("tier"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  proposalData: jsonb("proposal_data"),
  resultSummary: jsonb("result_summary"),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});