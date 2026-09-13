import { describe, expect, it } from "vitest";
import * as domain from "@/domain";
import * as adapters from "@/adapters";
import * as application from "@/application";
import * as container from "@/container";

describe("path aliases", () => {
  it("resolves @/ imports to src barrel files", async () => {
    expect(domain).toBeDefined();
    expect(adapters).toBeDefined();
    expect(application).toBeDefined();
    expect(container).toBeDefined();

    const viaDynamic = await import("@/domain");
    expect(viaDynamic).toBeDefined();
  });
});