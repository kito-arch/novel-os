import type {
  CompletionRequest,
  CompletionResult,
  ExtractionRequest,
  ExtractionResult,
  LlmClient,
} from "@/container/llm";
import type { StoryChangeProposal } from "@/domain/proposals";

const VIRTUAL_TOKENS = {
  inputTokens: 1,
  outputTokens: 1,
};

// Deterministic in-memory LlmClient for tests.
//   complete            → keyed canned strings (substring match on the user message).
//   extractStructured   → parsed fixture from a keyed proposal store (default: empty proposal).
// The extraction agent loop no longer talks to the LlmClient (it drives the Vercel AI SDK
// directly); scripted model turns live in tests/mocks/sdk-model.ts.
export interface MockLlmOptions {
  fixtures?: Record<string, StoryChangeProposal>;
  completions?: Record<string, string>;
  defaultCompletion?: string;
}

export class MockLlm implements LlmClient {
  private readonly fixtures: Record<string, StoryChangeProposal>;
  private readonly completions: Record<string, string>;
  private readonly defaultCompletion: string;

  constructor(options: MockLlmOptions = {}) {
    this.fixtures = options.fixtures ?? {};
    this.completions = options.completions ?? {};
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
}

export function createMockLlm(options: MockLlmOptions = {}): LlmClient {
  return new MockLlm(options);
}

export const mockLlm = new MockLlm();
