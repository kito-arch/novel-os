import { EntityTypeSchema } from "./entity-types";
import type { AttributeDef, AttributeKind, EntityType } from "./entity-types";
import { SEED_CREATED_AT } from "./builtins";

export interface StoryTypePreset {
  name: string;
  label: string;
  description: string;
  entityTypes: EntityType[];
}

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

const STARSHIP_ATTRIBUTE_DEFS = normalizeDefs([
  {
    key: "class",
    label: "Class",
    kind: "enum",
    enumValues: ["Falcon", "Battlestar", "Freighter"],
  },
  { key: "armament", label: "Armament", kind: "text", multi: true },
  { key: "captain", label: "Captain", kind: "ref", refType: "character" },
]);

const PLANET_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "climate", label: "Climate", kind: "text" },
  { key: "notable_features", label: "Notable Features", kind: "text", multi: true },
]);

const FACTION_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "goals", label: "Goals", kind: "text", multi: true },
  { key: "ideology", label: "Ideology", kind: "text" },
]);

const TECHNOLOGY_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "function", label: "Function", kind: "text" },
  { key: "power_source", label: "Power Source", kind: "text" },
]);

const ALIEN_SPECIES_ATTRIBUTE_DEFS = normalizeDefs([
  { key: "physiology", label: "Physiology", kind: "text" },
  { key: "homeworld", label: "Homeworld", kind: "text" },
]);

const presetEntityTypes: EntityType[] = EntityTypeSchema.array().parse([
  {
    id: "00000000-0000-4000-8000-000000000011",
    storyId: null,
    name: "starship",
    pluralName: "starships",
    baseKind: "physical",
    description: "A spaceship — anything from a freighter to a capital ship",
    attributeDefs: STARSHIP_ATTRIBUTE_DEFS,
    origin: "preset",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: "00000000-0000-4000-8000-000000000012",
    storyId: null,
    name: "planet",
    pluralName: "planets",
    baseKind: "place",
    description: "A world or moon",
    attributeDefs: PLANET_ATTRIBUTE_DEFS,
    origin: "preset",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: "00000000-0000-4000-8000-000000000013",
    storyId: null,
    name: "faction",
    pluralName: "factions",
    baseKind: "abstract",
    description: "An organization, guild or political power",
    attributeDefs: FACTION_ATTRIBUTE_DEFS,
    origin: "preset",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: "00000000-0000-4000-8000-000000000014",
    storyId: null,
    name: "technology",
    pluralName: "technology",
    baseKind: "physical",
    description: "A piece of advanced technology",
    attributeDefs: TECHNOLOGY_ATTRIBUTE_DEFS,
    origin: "preset",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
  {
    id: "00000000-0000-4000-8000-000000000015",
    storyId: null,
    name: "alien-species",
    pluralName: "alien-species",
    baseKind: "abstract",
    description: "A non-human species",
    attributeDefs: ALIEN_SPECIES_ATTRIBUTE_DEFS,
    origin: "preset",
    supersededBy: null,
    createdAt: SEED_CREATED_AT,
  },
]);

export const spaceOperaPreset: StoryTypePreset = {
  name: "space-opera",
  label: "Space Opera",
  description:
    "Starships, planets, factions, technology and alien species across the void.",
  entityTypes: presetEntityTypes,
};

export const storyTypePresets: Record<string, StoryTypePreset> = {
  "space-opera": spaceOperaPreset,
};

export function getPreset(name: string): StoryTypePreset | undefined {
  return storyTypePresets[name];
}