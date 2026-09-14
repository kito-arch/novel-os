import type { ZodType } from "zod";

export type ModelTier = "cheap" | "standard" | "best";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionRequest {
  tier: ModelTier;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  usage: TokenUsage;
}

// T is the inferred output of the Zod schema. Concrete extraction schemas live
// in the domain (e.g. StoryChangeProposal) and are passed by the services layer.
export interface ExtractionRequest<T> {
  tier: ModelTier;
  systemPrompt: string;
  userMessage: string;
  schema: ZodType<T>;
}

export interface ExtractionResult<T> {
  data: T;
  usage: TokenUsage;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;

  // JSON-mode structured extraction; the adapter validates the response against
  // request.schema and re-prompts once on a parse failure.
  extractStructured<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;
}