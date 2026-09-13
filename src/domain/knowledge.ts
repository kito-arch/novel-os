import { z } from "zod";

export const KnowledgeStatusSchema = z.enum([
  "known",
  "unknown",
  "believed_true",
  "believed_false",
]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export const EntityKnowledgeSchema = z.object({
  id: z.string().uuid(),
  subjectEntityId: z.string().uuid(),
  factId: z.string().uuid().nullable().default(null),
  knowledgeText: z.string(),
  status: KnowledgeStatusSchema,
  learnedWhen: z.string().nullable().default(null),
  learnedVia: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type EntityKnowledge = z.infer<typeof EntityKnowledgeSchema>;

export type KnowledgeClaim = EntityKnowledge;
export type KnowledgeChange = EntityKnowledge;

export function getKnowledge(
  rows: readonly EntityKnowledge[],
  subjectEntityId: string,
): EntityKnowledge[] {
  return rows.filter((row) => row.subjectEntityId === subjectEntityId);
}