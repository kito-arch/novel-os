import { describe, expect, it } from "vitest";
import * as domain from "@/domain";
import * as adapters from "@/adapters";
import * as services from "@/services";
import * as container from "@/container";

describe("path aliases", () => {
  it("resolves @/ imports to src barrel files", async () => {
    expect(domain).toBeDefined();
    expect(adapters).toBeDefined();
    expect(services).toBeDefined();
    expect(container).toBeDefined();

    const viaDynamic = await import("@/domain");
    expect(viaDynamic).toBeDefined();
  });
});