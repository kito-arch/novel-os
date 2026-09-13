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
// in the domain (e.g. StoryChangeProposal) and are passed by the application layer.
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

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema object for the tool's arguments.
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  // Nullable so assistant "tool-use" messages can carry arguments without text.
  content: string | null;
  // Present on assistant messages that request tool calls.
  toolCalls?: ToolCall[];
  // Present on tool messages: which call this result answers.
  toolCallId?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tier?: ModelTier;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  // The assistant message: final text and/or requested tool calls.
  message: ChatMessage;
  usage: TokenUsage;
}

export interface LlmClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;

  // JSON-mode structured extraction; the adapter validates the response against
  // request.schema and re-prompts once on a parse failure.
  extractStructured<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>>;

  // Multi-turn chat with native function calling. The story extraction agent
  // drives this loop: send messages + tool definitions, execute any returned
  // toolCalls, append the results as tool messages, repeat.
  chat(request: ChatRequest): Promise<ChatResult>;
}