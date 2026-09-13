import { describe, expect, it } from "vitest";
import {
  AttributeDefSchema,
  BASE_KIND_CATALOG,
  EntityTypeSchema,
  coreEntityTypes,
  spaceOperaPreset,
  validateAttributes,
  validateEntity,
  type EntityType,
  type MediaRef,
} from "@/domain";

function makeEntityType(overrides: Partial<EntityType> = {}): EntityType {
  return EntityTypeSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    storyId: "20000000-0000-4000-8000-000000000001",
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: null,
    attributeDefs: [],
    origin: "user",
    supersededBy: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  });
}

const media: MediaRef = {
  id: "70000000-0000-4000-8000-000000000001",
  url: "https://example.com/portrait.jpg",
  role: "portrait",
  caption: null,
  createdAt: new Date("2026-02-01T00:00:00.000Z"),
};

describe("entity type registry", () => {
  it("rejects an AttributeDef that sets multi on a non-multi-capable kind", () => {
    expect(() =>
      AttributeDefSchema.parse({ key: "alive", label: "Alive", kind: "boolean", multi: true }),
    ).toThrow();
  });

  it("rejects an enum AttributeDef missing enumValues", () => {
    expect(() =>
      AttributeDefSchema.parse({ key: "class", label: "Class", kind: "enum" }),
    ).toThrow();
  });

  it("rejects a ref AttributeDef missing refType", () => {
    expect(() =>
      AttributeDefSchema.parse({ key: "captain", label: "Captain", kind: "ref" }),
    ).toThrow();
  });

  it("rejects an entity type with an invalid baseKind", () => {
    expect(() => makeEntityType({ baseKind: "spirit" as never })).toThrow();
  });

  it("accepts valid AttributeDefs", () => {
    expect(
      AttributeDefSchema.parse({
        key: "armament",
        label: "Armament",
        kind: "text",
        multi: true,
      }).multi,
    ).toBe(true);
  });
});

describe("base kind catalog", () => {
  it("abstract base kinds do not support media", () => {
    expect(BASE_KIND_CATALOG.abstract.supportsMedia).toBe(false);
    expect(BASE_KIND_CATALOG.character.supportsMedia).toBe(true);
    expect(BASE_KIND_CATALOG.character.isCore).toBe(true);
    expect(BASE_KIND_CATALOG.physical.isCore).toBe(false);
  });
});

describe("built-in seeds and presets", () => {
  it("round-trips the character seed through the entity type schema", () => {
    const character = coreEntityTypes.find((type) => type.name === "character");
    expect(character).toBeDefined();
    const parsed = EntityTypeSchema.parse(character!);
    expect(parsed.baseKind).toBe("character");
    expect(parsed.origin).toBe("core");
    expect(parsed.attributeDefs.some((def) => def.key === "goals")).toBe(true);
  });

  it("seeds the space-opera preset including a starship def", () => {
    const starship = spaceOperaPreset.entityTypes.find((type) => type.name === "starship");
    expect(starship).toBeDefined();
    expect(starship!.baseKind).toBe("physical");
    expect(starship!.attributeDefs.some((def) => def.key === "armament")).toBe(true);
    for (const type of spaceOperaPreset.entityTypes) {
      expect(() => EntityTypeSchema.parse(type)).not.toThrow();
    }
  });
});

describe("validateAttributes", () => {
  const characterType = makeEntityType({
    name: "character",
    attributeDefs: [
      { key: "goals", label: "Goals", kind: "text", required: false, multi: true },
      { key: "rank", label: "Rank", kind: "text", required: true, multi: false },
      { key: "class", label: "Class", kind: "enum", required: false, multi: false, enumValues: ["Falcon", "Battlestar"] },
    ],
  });

  it("accepts valid attributes for the declared defs", () => {
    const result = validateAttributes(characterType, {
      goals: ["rule the galaxy"],
      rank: "Commander",
      class: "Falcon",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects attribute keys not declared by the entity type", () => {
    const result = validateAttributes(characterType, {
      goals: ["rule the galaxy"],
      rank: "Commander",
      eyeColor: "green",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "eyeColor")).toBe(true);
    }
  });

  it("rejects missing required attributes", () => {
    const result = validateAttributes(characterType, { goals: ["rule the galaxy"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.message.includes("rank"))).toBe(true);
    }
  });

  it("rejects enum values outside the allowed set", () => {
    const result = validateAttributes(characterType, {
      rank: "Commander",
      class: "Krayt",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a multi-def supplied as a single value", () => {
    const result = validateAttributes(characterType, {
      rank: "Commander",
      goals: "rule the galaxy",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateEntity", () => {
  const abstractType = makeEntityType({ name: "faction", baseKind: "abstract" });
  const characterType = makeEntityType({ name: "character" });

  it("rejects media on an entity of an abstract base kind", () => {
    const result = validateEntity(abstractType, { attributes: {}, media: [media] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "media")).toBe(true);
    }
  });

  it("accepts media on an entity whose base kind supports it", () => {
    const result = validateEntity(characterType, { attributes: {}, media: [media] });
    expect(result.ok).toBe(true);
  });
});