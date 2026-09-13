import { z } from "zod";

export const PlotThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().nullable().default(null),
  status: z.enum(["introduced", "active", "resolved", "abandoned"]),
  introducedInSceneId: z.string().uuid().nullable().default(null),
  lastMentionedInSceneId: z.string().uuid().nullable().default(null),
  relatedEntityIds: z.array(z.string().uuid()).default([]),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type PlotThread = z.infer<typeof PlotThreadSchema>;

export const OpenQuestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string().min(1),
  relatedEntityIds: z.array(z.string().uuid()).default([]),
  introducedInDictationId: z.string().uuid().nullable().default(null),
  resolvedInDictationId: z.string().uuid().nullable().default(null),
  isResolved: z.boolean().default(false),
  createdAt: z.date(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;