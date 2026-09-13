import { describe, expect, it } from "vitest";
import { storyChangeSchema } from "@/domain";

const spaceOperaProposal = {
  entityTypes: [
    {
      name: "starship",
      pluralName: "starships",
      baseKind: "physical",
      description: "A spaceship",
      attributeDefs: [
        { key: "class", label: "Class", kind: "enum", enumValues: ["Falcon", "Battlestar", "Freighter"] },
        { key: "armament", label: "Armament", kind: "text", multi: true },
        { key: "captain", label: "Captain", kind: "ref", refType: "character" },
      ],
    },
  ],
  entities: [
    {
      entityTypeName: "starship",
      name: "The Relentless",
      aliases: ["Relentless"],
      attributes: { class: "Falcon", armament: ["twin ion cannons"], captain: "Aria Voss" },
    },
    { entityTypeName: "starship", name: "Dauntless", attributes: { class: "Battlestar" } },
  ],
  events: [
    {
      title: "The Relentless and her adversary trade fire",
      settingName: "The Oasis Moon",
      participantNames: ["The Relentless", "Dauntless"],
      confidence: "explicit",
    },
  ],
  knowledge: [
    {
      subjectEntityName: "Aria Voss",
      knowledgeText: "The Relentless is armed with twin ion cannons",
      status: "known",
    },
  ],
};

describe("storyChangeSchema", () => {
  it("parses a proposal that registers a starship type, two ships, an event and knowledge", () => {
    const parsed = storyChangeSchema.parse(spaceOperaProposal);

    expect(parsed.entityTypes).toHaveLength(1);
    expect(parsed.entityTypes[0].baseKind).toBe("physical");
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.events[0].settingName).toBe("The Oasis Moon");
    expect(parsed.events[0].participantNames).toContain("The Relentless");
    expect(parsed.knowledge).toHaveLength(1);
    expect(parsed.knowledge[0].subjectEntityName).toBe("Aria Voss");
  });

  it("applies defaults (empty arrays) for absent fields", () => {
    const parsed = storyChangeSchema.parse({
      facts: [{ subject: "Aria Voss", predicate: "commands", objectValue: "The Relentless", confidence: "inferred" }],
    });

    expect(parsed.entityTypes).toEqual([]);
    expect(parsed.entities).toEqual([]);
    expect(parsed.events).toEqual([]);
    expect(parsed.knowledge).toEqual([]);
    expect(parsed.contradictions).toEqual([]);
    expect(parsed.openQuestions).toEqual([]);
  });

  it("rejects an invalid confidence value", () => {
    expect(() =>
      storyChangeSchema.parse({
        facts: [{ subject: "A", predicate: "is", objectValue: "B", confidence: "certain" }],
      }),
    ).toThrow();
  });

  it("rejects a proposed entity type missing baseKind", () => {
    expect(() =>
      storyChangeSchema.parse({
        entityTypes: [{ name: "starship", pluralName: "starships" }],
      }),
    ).toThrow();
  });

  it("rejects a proposed entity referencing an entity type name of empty string", () => {
    expect(() =>
      storyChangeSchema.parse({
        entities: [{ entityTypeName: "", name: "The Relentless" }],
      }),
    ).toThrow();
  });

  it("rejects facts with unknown keys stripped to a safe proposal shape", () => {
    const parsed = storyChangeSchema.parse({
      facts: [{ subject: "A", predicate: "is", objectValue: "B", confidence: "explicit", extra: true }],
    });
    expect(parsed.facts[0]).not.toHaveProperty("extra");
  });
});