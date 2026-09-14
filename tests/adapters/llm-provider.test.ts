import { describe, expect, it } from "vitest";
import { createLanguageModel } from "@/adapters";
import { NotImplementedError } from "@/container";
import { loadConfig } from "@/config";

interface ModelIdentity {
  provider: string;
  modelId: string;
}

describe("createLanguageModel (T9 real LLM adapter)", () => {
  it("builds an AI SDK language model for the openai provider", () => {
    const model = createLanguageModel(
      loadConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" }),
    ) as ModelIdentity;
    expect(model.provider.startsWith("openai")).toBe(true);
    expect(model.modelId).toBe("gpt-5-mini");
  });

  it("builds an AI SDK language model for the anthropic provider", () => {
    const model = createLanguageModel(
      loadConfig({ LLM_PROVIDER: "anthropic", LLM_API_KEY: "k" }),
    ) as ModelIdentity;
    expect(model.provider.startsWith("anthropic")).toBe(true);
    expect(model.modelId).toBe("gpt-5-mini");
  });

  it("refuses the test-only mock provider outside tests", () => {
    expect(() => createLanguageModel(loadConfig({ LLM_PROVIDER: "mock" }))).toThrow(
      NotImplementedError,
    );
    expect(() => createLanguageModel(loadConfig({ LLM_PROVIDER: "mock" }))).toThrow(
      /tests\/mocks/,
    );
  });
});