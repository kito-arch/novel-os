import { describe, expect, it } from "vitest";
import { createContainer } from "@evyweb/ioctopus";
import type { AppRegistry } from "@/container";
import { NotImplementedError, buildContainer, createAppModule } from "@/container";
import { loadConfig } from "@/config";

describe("ioctopus container", () => {
  it("binds CONFIG as a value and resolves it typed", () => {
    const config = loadConfig({});
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(config));
    expect(container.get("CONFIG")).toBe(config);
  });

  it("loads an app module into a fresh typed container", () => {
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(loadConfig({})));
    expect(container.get("CONFIG").LLM_PROVIDER).toBe("mock");
    expect(container.get("CONFIG").STT_PROVIDER).toBe("mock");
  });

  it("buildContainer reads process.env but has no production adapters yet", () => {
    expect(() => buildContainer()).toThrow(NotImplementedError);
  });
});