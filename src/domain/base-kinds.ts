import { z } from "zod";

export const EntityBaseKindSchema = z.enum([
  "character",
  "place",
  "physical",
  "abstract",
]);
export type EntityBaseKind = z.infer<typeof EntityBaseKindSchema>;

export interface BaseKindCapabilities {
  label: string;
  supportsMedia: boolean;
  isCore: boolean;
}

export const BASE_KIND_CATALOG: Record<EntityBaseKind, BaseKindCapabilities> = {
  character: { label: "Character", supportsMedia: true, isCore: true },
  place: { label: "Place", supportsMedia: true, isCore: true },
  physical: { label: "Physical instance", supportsMedia: true, isCore: false },
  abstract: { label: "Abstract", supportsMedia: false, isCore: false },
};