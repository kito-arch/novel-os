import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { AppConfig } from "@/config";
import { NotImplementedError } from "@/container";

// T9 — the real LLM adapter for the extraction agent loop. Provider-agnostic:
// LLM_PROVIDER selects the AI SDK vendor (any vendor with a provider package
// can be added here) and LLM_STANDARD_MODEL names the model. Production and
// development both resolve a real model (config requires LLM_API_KEY for every
// non-mock provider); tests inject scripted models from tests/mocks instead.
export function createLanguageModel(config: AppConfig): LanguageModel {
  switch (config.LLM_PROVIDER) {
    case "openai":
      return createOpenAI({ apiKey: config.LLM_API_KEY }).languageModel(
        config.LLM_STANDARD_MODEL,
      );
    case "anthropic":
      return createAnthropic({ apiKey: config.LLM_API_KEY }).languageModel(
        config.LLM_STANDARD_MODEL,
      );
    case "mock":
      throw new NotImplementedError(
        "LLM_PROVIDER=mock only exists as a test double under tests/mocks. " +
          "Set LLM_PROVIDER=openai or anthropic (with LLM_API_KEY) for the real extraction loop.",
      );
  }
}