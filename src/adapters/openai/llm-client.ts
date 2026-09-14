import { createOpenAI } from "@ai-sdk/openai";
import type { OpenAIProvider } from "@ai-sdk/openai";
import { generateObject, generateText, zodSchema } from "ai";
import type { LanguageModel } from "ai";
import type {
  CompletionRequest,
  CompletionResult,
  ExtractionRequest,
  ExtractionResult,
  LlmClient,
  ModelTier,
  TokenUsage,
} from "@/container/llm";

export interface OpenAiTierModels {
  cheap?: string;
  standard?: string;
  best?: string;
}

export interface OpenAiLlmOptions {
  apiKey?: string;
  // Provider model per tier, overriding DEFAULT_TIER_MODELS (built from the
  // LLM_CHEAP/STANDARD/BEST_MODEL config keys by buildContainer).
  models?: OpenAiTierModels;
  // Test seam: override the AI SDK model factory so adapter tests run against a
  // scripted LanguageModel from tests/mocks instead of a live OpenAI connection.
  modelForTier?: (tier: ModelTier) => LanguageModel;
}

const DEFAULT_TIER_MODELS: Required<OpenAiTierModels> = {
  cheap: "gpt-5-nano",
  standard: "gpt-5-mini",
  best: "gpt-5-pro",
};

// T9.1 — OpenAI-backed LlmClient. complete uses plain text generation;
// extractStructured uses JSON-mode generation, validates the answer against the
// caller's Zod schema, and re-prompts exactly once on a parse failure.
export class OpenAiLlm implements LlmClient {
  private readonly modelForTier: (tier: ModelTier) => LanguageModel;

  constructor(options: OpenAiLlmOptions = {}) {
    this.modelForTier =
      options.modelForTier ??
      (() => {
        let provider: OpenAIProvider | undefined;
        return (tier: ModelTier): LanguageModel => {
          provider ??= createOpenAI({ apiKey: options.apiKey });
          const model = options.models?.[tier] ?? DEFAULT_TIER_MODELS[tier];
          return provider.languageModel(model);
        };
      })();
  }

  private static usageOf(usage: { inputTokens?: number; outputTokens?: number }): TokenUsage {
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const result = await generateText({
      model: this.modelForTier(request.tier),
      system: request.systemPrompt,
      prompt: request.userMessage,
      temperature: request.temperature,
      maxOutputTokens: request.maxTokens,
    });
    return { text: result.text, usage: OpenAiLlm.usageOf(result.usage) };
  }

  async extractStructured<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>> {
    const generate = (prompt: string) =>
      generateObject({
        model: this.modelForTier(request.tier),
        system: request.systemPrompt,
        prompt,
        schema: zodSchema(request.schema),
      });

    try {
      const result = await generate(request.userMessage);
      return { data: result.object, usage: OpenAiLlm.usageOf(result.usage) };
    } catch (firstError) {
      const repaired = await generate(
        `${request.userMessage}\n\nYour previous response failed schema validation:\n${
          firstError instanceof Error ? firstError.message : String(firstError)
        }\nReturn valid JSON that matches the expected schema exactly.`,
      );
      return { data: repaired.object, usage: OpenAiLlm.usageOf(repaired.usage) };
    }
  }
}

export function openaiLlm(options: OpenAiLlmOptions = {}): LlmClient {
  return new OpenAiLlm(options);
}