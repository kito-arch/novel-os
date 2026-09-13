import { EntityTypeSchema } from "./entity-types";
import type { AttributeDef, AttributeKind, EntityType } from "./entity-types";

const CORE_CHARACTER_ID = "00000000-0000-4000-8000-000000000001";
const CORE_PLACE_ID = "00000000-0000-4000-8000-000000000002";
const CORE_OBJECT_ID = "00000000-0000-4000-8000-000000000003";
export const SEED_CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

interface SeedAttributeDef {
  key: string;
  label: string;
  kind: AttributeKind;
  required?: boolean;
  multi?: boolean;
  enumValues?: string[];
  refType?: string;
}

function normalizeDefs(defs: SeedAttributeDef[]): AttributeDef[] {
  return defs.map((def) => ({ ...def, required: def.required ?? false, multi: def.multi ?? false }));
}

const CHARACTER_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "nickname", label: "Nickname", kind: "text" },
  { key: "goals", label: "Goals", kind: "text", multi: true },
  { key: "fears", label: "Fears", kind: "text", multi: true },
  { key: "desires", label: "Desires", kind: "text", multi: true },
  { key: "beliefs", label: "Beliefs", kind: "text", multi: true },
  { key: "secrets", label: "Secrets", kind: "text", multi: true },
  { key: "appearance", label: "Appearance", kind: "text", multi: true },
  { key: "personality", label: "Personality", kind: "text", multi: true },
  { key: "backstory", label: "Backstory", kind: "text" },
]);

const PLACE_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "description", label: "Description", kind: "text" },
  { key: "climate", label: "Climate", kind: "text" },
  { key: "notable_features", label: "Notable Features", kind: "text", multi: true },
]);

const OBJECT_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "significance", label: "Significance", kind: "text" },
  { key: "possessor", label: "Possessor", kind: "ref", refType: "character" },
]);

export const coreEntityTypes: EntityType[] = EntityTypeSchema.array().parse([
  {
    id: CORE_CHARACTER_ID,
    storyId: null,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: "Characters who drive the story",
    attributeDefs: CHARACTER_ATTRIBUTE_DEFS,
    origin: "core",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: CORE_PLACE_ID,
    storyId: null,
    name: "place",
    pluralName: "places",
    baseKind: "place",
    description: "Places where the story unfolds",
    attributeDefs: PLACE_ATTRIBUTE_DEFS,
    origin: "core",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: CORE_OBJECT_ID,
    storyId: null,
    name: "object",
    pluralName: "objects",
    baseKind: "physical",
    description: "A physical object of note",
    attributeDefs: OBJECT_ATTRIBUTE_DEFS,
    origin: "core",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
]);

export function getCoreEntityType(name: string): EntityType | undefined {
  return coreEntityTypes.find((type) => type.name === name);
}