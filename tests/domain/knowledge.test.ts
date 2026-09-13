import { describe, expect, it } from "vitest";
import { EntityKnowledgeSchema, getKnowledge, type EntityKnowledge } from "@/domain";

function makeKnowledge(overrides: Partial<EntityKnowledge> = {}): EntityKnowledge {
  return EntityKnowledgeSchema.parse({
    id: "a0000000-0000-4000-8000-000000000001",
    subjectEntityId: "b0000000-0000-4000-8000-000000000001",
    factId: null,
    knowledgeText: "The Relentless is armed",
    status: "known",
    learnedWhen: null,
    learnedVia: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("knowledge generalization", () => {
  it("references the subject by a plain entity id of any type", () => {
    const starshipEntityId = "b0000000-0000-4000-8000-000000000001";
    const row = makeKnowledge({ subjectEntityId: starshipEntityId });

    expect(row.subjectEntityId).toBe(starshipEntityId);
    expect(row).not.toHaveProperty("characterId");
  });

  it("filters knowledge rows by subject entity id", () => {
    const aria = "b0000000-0000-4000-8000-000000000001";
    const relic = "b0000000-0000-4000-8000-000000000002";
    const rows = [
      makeKnowledge({ id: "a0000000-0000-4000-8000-000000000001", subjectEntityId: aria }),
      makeKnowledge({ id: "a0000000-0000-4000-8000-000000000002", subjectEntityId: relic }),
      makeKnowledge({ id: "a0000000-0000-4000-8000-000000000003", subjectEntityId: aria }),
    ];

    expect(getKnowledge(rows, aria)).toHaveLength(2);
    expect(getKnowledge(rows, relic)).toHaveLength(1);
  });

  it("supports timeline-based (learnedWhen) filtering", () => {
    const rows = [
      makeKnowledge({ id: "a0000000-0000-4000-8000-000000000001", learnedWhen: "Chapter 2" }),
      makeKnowledge({ id: "a0000000-0000-4000-8000-000000000002", learnedWhen: "Chapter 5" }),
    ];

    expect(rows.filter((row) => row.learnedWhen === "Chapter 2")).toHaveLength(1);
  });

  it("keeps status within the allowed set", () => {
    expect(() => makeKnowledge({ status: "probably" as never })).toThrow();
  });
});