import type { LanguageModelV4Content, LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4, mockId } from "ai/test";
import type { LanguageModel } from "ai";

// One scripted model step: either a text reply (no tool calls → the SDK loop
// ends naturally) or the tool calls the model "offers" next. Mirrors the old
// MockLlm.chatScript for the T5.4 agent loop, but drives generateText through
// a real AI SDK LanguageModel (MockLanguageModelV4) so the whole stack —
// tool schemas, stopWhen budgets, step assembly — is exercised.
export interface ScriptedModelStep {
  content?: string;
  toolCalls?: ReadonlyArray<{ name: string; arguments?: Record<string, unknown> }>;
}

const MOCK_USAGE: LanguageModelV4GenerateResult["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

// Walks the script one doGenerate call per step. If the script is exhausted the
// final step repeats, so runaway loops terminate deterministically instead of throwing.
export function scriptedModel(steps: ReadonlyArray<ScriptedModelStep>): LanguageModel {
  const nextToolCallId = mockId({ prefix: "scripted" });
  let index = 0;

  return new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
      const step = steps[Math.min(index, steps.length - 1)] ?? { content: "done" };
      index += 1;

      if (step.toolCalls && step.toolCalls.length > 0) {
        const content: LanguageModelV4Content[] = step.toolCalls.map((call) => ({
          type: "tool-call",
          toolCallId: nextToolCallId(),
          toolName: call.name,
          input: JSON.stringify(call.arguments ?? {}),
        }));
        return {
          content,
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }

      return {
        content: [{ type: "text", text: step.content ?? "" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: MOCK_USAGE,
        warnings: [],
      };
    },
  });
}