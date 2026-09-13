import { describe, expect, it } from "vitest";
import {
  FactSchema,
  assertConfidenceUpgradeAllowed,
  canUpgradeConfidence,
  listActiveFacts,
  type Fact,
} from "@/domain";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return FactSchema.parse({
    id: "80000000-0000-4000-8000-000000000001",
    subject: "Aria Voss",
    predicate: "commands",
    objectValue: "The Relentless",
    confidence: "explicit",
    provenance: {
      dictationId: "90000000-0000-4000-8000-000000000001",
      textChunk: "Aria Voss commands the Relentless",
      confidence: "explicit",
    },
    supersededBy: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  });
}

describe("FactSchema", () => {
  it("accepts only the four confidence values", () => {
    for (const confidence of ["explicit", "implied", "inferred", "unknown"]) {
      expect(() => makeFact({ confidence: confidence as Fact["confidence"] })).not.toThrow();
    }
    expect(() => makeFact({ confidence: "certain" as never })).toThrow();
  });
});

describe("fact supersede rules", () => {
  it("excludes superseded facts from active canon queries", () => {
    const active = makeFact();
    const superseded = makeFact({ id: "80000000-0000-4000-8000-000000000002", supersededBy: active.id });

    const activeFacts = listActiveFacts([active, superseded]);

    expect(activeFacts).toEqual([active]);
  });

  it("treats facts without supersededBy as active", () => {
    const fact = makeFact();
    expect(listActiveFacts([fact])).toHaveLength(1);
  });
});

describe("confidence upgrade rule", () => {
  it("never auto-upgrades an inferred fact to explicit", () => {
    expect(canUpgradeConfidence("inferred", "explicit")).toBe(false);
    expect(() => assertConfidenceUpgradeAllowed("inferred", "explicit")).toThrow();
  });

  it("allows stepping an inferred fact toward explicit only via implied", () => {
    expect(canUpgradeConfidence("inferred", "implied")).toBe(true);
    expect(canUpgradeConfidence("implied", "explicit")).toBe(true);
  });

  it("allows downgrading an explicit fact to inferred", () => {
    expect(canUpgradeConfidence("explicit", "inferred")).toBe(true);
    expect(() => assertConfidenceUpgradeAllowed("explicit", "inferred")).not.toThrow();
  });
});