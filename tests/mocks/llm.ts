import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  CompletionRequest,
  CompletionResult,
  ExtractionRequest,
  ExtractionResult,
  LlmClient,
  ToolCall,
} from "@/container/llm";
import type { StoryChangeProposal } from "@/domain/proposals";

const VIRTUAL_TOKENS = {
  inputTokens: 1,
  outputTokens: 1,
};

// Deterministic in-memory LlmClient for tests and dev.
//   complete            → keyed canned strings (substring match on the user message).
//   extractStructured   → parsed fixture from a keyed proposal store (default: empty proposal).
//   chat                → walks a script of { content } / { toolCalls } steps, used to drive the
//                         extraction agent loop (T5.4) without a real provider.
export interface MockLlmOptions {
  fixtures?: Record<string, StoryChangeProposal>;
  completions?: Record<string, string>;
  // Each chat() call returns the next scripted step. If the script runs out,
  // a final "done" message with no tool calls is returned (the agent finishes).
  chatScript?: ReadonlyArray<{ content?: string; toolCalls?: ToolCall[] }>;
  defaultCompletion?: string;
}

export class MockLlm implements LlmClient {
  private readonly fixtures: Record<string, StoryChangeProposal>;
  private readonly completions: Record<string, string>;
  private readonly chatScript: ReadonlyArray<{ content?: string; toolCalls?: ToolCall[] }>;
  private readonly defaultCompletion: string;
  private scriptIndex = 0;

  constructor(options: MockLlmOptions = {}) {
    this.fixtures = options.fixtures ?? {};
    this.completions = options.completions ?? {};
    this.chatScript = options.chatScript ?? [];
    this.defaultCompletion = options.defaultCompletion ?? "ok";
  }

  // Returns the first fixture whose key is a substring of the user message.
  private findFixture(userMessage: string): StoryChangeProposal | undefined {
    return Object.entries(this.fixtures).find(([key]) => userMessage.includes(key))?.[1];
  }

  private findCompletion(userMessage: string): string {
    return Object.entries(this.completions).find(([key]) => userMessage.includes(key))?.[1]
      ?? this.defaultCompletion;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return { text: this.findCompletion(request.userMessage), usage: VIRTUAL_TOKENS };
  }

  async extractStructured<T>(request: ExtractionRequest<T>): Promise<ExtractionResult<T>> {
    const fixture = this.findFixture(request.userMessage);
    const data = request.schema.parse(fixture ?? {});
    return { data, usage: VIRTUAL_TOKENS };
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    void request;
    const step = this.chatScript[this.scriptIndex];
    if (step !== undefined) {
      this.scriptIndex += 1;
    }
    if (step?.toolCalls?.length) {
      const message: ChatMessage = {
        role: "assistant",
        content: step.content ?? null,
        toolCalls: step.toolCalls,
      };
      return { message, usage: VIRTUAL_TOKENS };
    }
    const message: ChatMessage = {
      role: "assistant",
      content: step?.content !== undefined ? step.content : this.defaultCompletion,
    };
    return { message, usage: VIRTUAL_TOKENS };
  }
}

export function createMockLlm(options: MockLlmOptions = {}): LlmClient {
  return new MockLlm(options);
}

export const mockLlm = new MockLlm();