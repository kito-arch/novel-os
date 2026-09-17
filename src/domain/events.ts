import { z } from "zod";
import { ConfidenceSchema, ProvenanceSchema } from "./provenance";

export const TimelineRefSchema = z.object({
  raw: z.string(),
  normalized: z
    .object({
      chapter: z.string().optional(),
      day: z.string().optional(),
      hour: z.string().optional(),
      order: z.number(),
    })
    .optional(),
});
export type TimelineRef = z.infer<typeof TimelineRefSchema>;

export const EventSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  settingId: z.string().uuid().nullable().default(null),
  when: TimelineRefSchema.nullable().default(null),
  motivation: z.string().nullable().default(null),
  consequences: z.array(z.string()).default([]),
  knowledgeGained: z.array(z.string()).default([]),
  knowledgeConcealed: z.array(z.string()).default([]),
  participants: z.array(z.string().uuid()).default([]),
  involvedObjects: z.array(z.string().uuid()).default([]),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  sceneId: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type StoryEvent = z.infer<typeof EventSchema>;