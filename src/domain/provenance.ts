import { z } from "zod";

export const ConfidenceSchema = z.enum(["explicit", "implied", "inferred", "unknown"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ProvenanceSchema = z.object({
  dictationId: z.string().uuid(),
  textChunk: z.string(),
  confidence: ConfidenceSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const FactKindSchema = z.enum([
  "identity",
  "attribute",
  "event",
  "relationship",
  "state",
]);
export type FactKind = z.infer<typeof FactKindSchema>;

export const ClaimSchema = z.object({
  subject: z.string(),
  predicate: z.string(),
  objectValue: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
});
export type Claim = z.infer<typeof ClaimSchema>;

export const FactSchema = z.object({
  id: z.string().uuid(),
  subject: z.string(),
  predicate: z.string(),
  objectValue: z.string().nullable().default(null),
  confidence: ConfidenceSchema,
  provenance: ProvenanceSchema,
  supersededBy: z.string().uuid().nullable().default(null),
  createdAt: z.date(),
});
export type Fact = z.infer<typeof FactSchema>;

export function listActiveFacts(facts: readonly Fact[]): Fact[] {
  return facts.filter((fact) => fact.supersededBy === null);
}

export function canUpgradeConfidence(from: Confidence, to: Confidence): boolean {
  if (from === "inferred" && to === "explicit") return false;
  return true;
}

export function assertConfidenceUpgradeAllowed(from: Confidence, to: Confidence): void {
  if (!canUpgradeConfidence(from, to)) {
    throw new Error("inferred facts never auto-upgrade to explicit");
  }
}