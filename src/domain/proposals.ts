import { z } from "zod";
import { AttributeKindSchema, AttributeValueSchema } from "./entity-types";
import { EntityBaseKindSchema } from "./base-kinds";
import { ConfidenceSchema, ClaimSchema } from "./provenance";
import { TimelineRefSchema } from "./events";
import { KnowledgeStatusSchema } from "./knowledge";

export const ProposedAttributeDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  kind: AttributeKindSchema,
  required: z.boolean().default(false),
  multi: z.boolean().default(false),
  enumValues: z.array(z.string()).optional(),
  refType: z.string().optional(),
});
export type ProposedAttributeDef = z.infer<typeof ProposedAttributeDefSchema>;

export const ProposedEntityTypeSchema = z.object({
  name: z.string().min(1),
  pluralName: z.string().min(1),
  baseKind: EntityBaseKindSchema,
  description: z.string().nullable().default(null),
  attributeDefs: z.array(ProposedAttributeDefSchema).default([]),
});
export type ProposedEntityType = z.infer<typeof ProposedEntityTypeSchema>;

export const ProposedEntitySchema = z.object({
  entityTypeName: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  attributes: z.record(z.string(), AttributeValueSchema).default({}),
});
export type ProposedEntity = z.infer<typeof ProposedEntitySchema>;

export const ProposedEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  settingName: z.string().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  motivation: z.string().nullable().default(null),
  consequences: z.array(z.string()).default([]),
  knowledgeGained: z.array(z.string()).default([]),
  knowledgeConcealed: z.array(z.string()).default([]),
  participantNames: z.array(z.string()).default([]),
  involvedObjectNames: z.array(z.string()).default([]),
  confidence: ConfidenceSchema,
  sceneId: z.string().uuid().nullable().default(null),
});
export type ProposedEvent = z.infer<typeof ProposedEventSchema>;

export const ProposedRelationshipSchema = z.object({
  fromEntityName: z.string().min(1),
  toEntityName: z.string().min(1),
  kind: z.string().min(1),
  details: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
});
export type ProposedRelationship = z.infer<typeof ProposedRelationshipSchema>;

export const ProposedFactSchema = ClaimSchema;
export type ProposedFact = z.infer<typeof ProposedFactSchema>;

export const ProposedKnowledgeSchema = z.object({
  subjectEntityName: z.string().min(1),
  knowledgeText: z.string(),
  status: KnowledgeStatusSchema,
  learnedWhen: z.string().nullable().default(null),
  learnedVia: z.string().nullable().default(null),
});
export type ProposedKnowledge = z.infer<typeof ProposedKnowledgeSchema>;

export const ProposedSceneSchema = z.object({
  title: z.string().nullable().default(null),
  settingName: z.string().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  summary: z.string().nullable().default(null),
  chapterNumber: z.number().nullable().default(null),
  participantNames: z.array(z.string()).default([]),
});
export type ProposedScene = z.infer<typeof ProposedSceneSchema>;

export const ProposedPlotThreadSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  status: z.enum(["introduced", "active", "resolved", "abandoned"]),
  relatedEntityNames: z.array(z.string()).default([]),
});
export type ProposedPlotThread = z.infer<typeof ProposedPlotThreadSchema>;

export const ContradictionSchema = z.object({
  existingFactDescription: z.string(),
  newFactDescription: z.string(),
  recommendedAction: z.enum(["supersede", "flag_soft", "flag_hard", "ignore"]),
});
export type Contradiction = z.infer<typeof ContradictionSchema>;

export const storyChangeSchema = z.object({
  entityTypes: z.array(ProposedEntityTypeSchema).default([]),
  entities: z.array(ProposedEntitySchema).default([]),
  events: z.array(ProposedEventSchema).default([]),
  relationships: z.array(ProposedRelationshipSchema).default([]),
  facts: z.array(ProposedFactSchema).default([]),
  knowledge: z.array(ProposedKnowledgeSchema).default([]),
  scenes: z.array(ProposedSceneSchema).default([]),
  plotThreads: z.array(ProposedPlotThreadSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  contradictions: z.array(ContradictionSchema).default([]),
});

export const StoryChangeProposalSchema = storyChangeSchema;
export type StoryChangeProposal = z.infer<typeof storyChangeSchema>;