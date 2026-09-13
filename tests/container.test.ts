import { describe, expect, it } from "vitest";
import { createContainer } from "@evyweb/ioctopus";
import type { AppRegistry } from "@/container";
import { buildContainer, createAppModule } from "@/container";
import { loadConfig } from "@/config";

describe("ioctopus container", () => {
  it("binds CONFIG as a value and resolves it typed", () => {
    const config = loadConfig({});
    const container = buildContainer(config);
    expect(container.get("CONFIG")).toBe(config);
  });

  it("loads an app module into a fresh typed container", () => {
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(loadConfig({})));
    expect(container.get("CONFIG").LLM_PROVIDER).toBe("mock");
    expect(container.get("CONFIG").STT_PROVIDER).toBe("mock");
  });

  it("buildContainer defaults to process.env", () => {
    const container = buildContainer();
    expect(container.get("CONFIG").LLM_CHEAP_MODEL).toBe("gpt-5-nano");
  });
});