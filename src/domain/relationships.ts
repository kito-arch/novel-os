import { z } from "zod";
import { ConfidenceSchema, ProvenanceSchema } from "./provenance";

export const RelationshipSchema = z.object({
  id: z.string().uuid(),
  fromEntityId: z.string().uuid(),
  toEntityId: z.string().uuid(),
  kind: z.string().min(1),
  details: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const RelationshipChangeSchema = z.object({
  relationshipId: z.string().uuid(),
  newKind: z.string().optional(),
  newDetails: z.string().nullable().default(null),
  ended: z.boolean().default(false),
});
export type RelationshipChange = z.infer<typeof RelationshipChangeSchema>;