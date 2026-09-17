import { describe, expect, it } from "vitest";
import { linkEntities } from "@/ui/link-entities";
import type { Entity } from "@/domain/entities";

function entity(id: string, name: string, aliases: string[] = []): Entity {
  return {
    id,
    storyId: "s1",
    entityTypeId: "t1",
    name,
    aliases,
    attributes: {},
    media: [],
    createdAt: new Date(),
  };
}

describe("linkEntities", () => {
  it("returns text unchanged when no entities", () => {
    expect(linkEntities("Hello world", [])).toBe("Hello world");
  });

  it("replaces a simple name", () => {
    const entities = [entity("e1", "William")];
    expect(linkEntities("William walked in.", entities)).toBe(
      "@[William](e1) walked in.",
    );
  });

  it("replaces longest match first (John Smith before John)", () => {
    const entities = [entity("e1", "John"), entity("e2", "John Smith")];
    const result = linkEntities("John and John Smith arrived.", entities);
    expect(result).toBe("@[John](e1) and @[John Smith](e2) arrived.");
  });

  it("replaces via alias using canonical name", () => {
    const entities = [entity("e1", "William Rogers", ["Will", "Bill"])];
    expect(linkEntities("Will came with Bill.", entities)).toBe(
      "@[William Rogers](e1) came with @[William Rogers](e1).",
    );
  });

  it("does not replace text already inside a mention", () => {
    const entities = [entity("e1", "William")];
    const input = "@[William](e1) met William again.";
    const result = linkEntities(input, entities);
    expect(result).toBe("@[William](e1) met @[William](e1) again.");
  });

  it("does not match partial words (Johnson !== John)", () => {
    const entities = [entity("e1", "John")];
    expect(linkEntities("Johnson arrived.", entities)).toBe("Johnson arrived.");
  });

  it("is case-insensitive", () => {
    const entities = [entity("e1", "William")];
    expect(linkEntities("WILLIAM walked in.", entities)).toBe(
      "@[William](e1) walked in.",
    );
  });

  it("handles empty text", () => {
    const entities = [entity("e1", "William")];
    expect(linkEntities("", entities)).toBe("");
  });
});
