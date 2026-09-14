import { describe, expect, it } from "vitest";
import { z } from "zod";
import { openaiLlm } from "@/adapters/openai";
import { storyChangeSchema } from "@/domain/proposals";
import { scriptedModel } from "../mocks/sdk-model";

const TinySchema = z.object({ title: z.string().min(1) });

describe("OpenAiLlm (T9.1)", () => {
  it("complete returns the model text and token usage for the requested tier", async () => {
    const usedTiers: string[] = [];
    const llm = openaiLlm({
      modelForTier: (tier) => {
        usedTiers.push(tier);
        return scriptedModel([{ content: "The safe was already open." }]);
      },
    });

    const result = await llm.complete({
      tier: "best",
      systemPrompt: "You are a narrator.",
      userMessage: "Describe the burglary.",
      temperature: 0.2,
      maxTokens: 256,
    });

    expect(usedTiers).toEqual(["best"]);
    expect(result.text).toBe("The safe was already open.");
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });

  it("extractStructured parses and validates the model's JSON against the schema", async () => {
    const llm = openaiLlm({
      modelForTier: () => scriptedModel([{ content: JSON.stringify({ title: "The Heist" }) }]),
    });

    const result = await llm.extractStructured({
      tier: "standard",
      systemPrompt: "Output JSON matching the schema.",
      userMessage: "Extract the title.",
      schema: TinySchema,
    });

    expect(result.data).toEqual({ title: "The Heist" });
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });

  it("re-prompts exactly once when the model's JSON fails schema validation", async () => {
    const model = scriptedModel([
      { content: "this is not json" },
      { content: JSON.stringify({ title: "Second Draft" }) },
    ]);
    const llm = openaiLlm({ modelForTier: () => model });

    const result = await llm.extractStructured({
      tier: "cheap",
      systemPrompt: "Output JSON matching the schema.",
      userMessage: "Extract the title.",
      schema: TinySchema,
    });

    expect(result.data).toEqual({ title: "Second Draft" });
    expect(result.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
  });

  it("extractStructured validates against a full domain schema with defaults", async () => {
    const llm = openaiLlm({
      modelForTier: () =>
        scriptedModel([{ content: JSON.stringify({ entityTypes: [], events: [] }) }]),
    });

    const result = await llm.extractStructured({
      tier: "standard",
      systemPrompt: "You are a story world extractor.",
      userMessage: "Extract the changes.",
      schema: storyChangeSchema,
    });

    expect(result.data.contradictions).toEqual([]);
    expect(result.data.openQuestions).toEqual([]);
    expect(result.data.plotThreads).toEqual([]);
  });

  it("still raises when the repair attempt also fails validation", async () => {
    const model = scriptedModel([{ content: "nope" }, { content: "still nope" }]);
    const llm = openaiLlm({ modelForTier: () => model });

    await expect(
      llm.extractStructured({
        tier: "cheap",
        systemPrompt: "Output JSON matching the schema.",
        userMessage: "Extract the title.",
        schema: TinySchema,
      }),
    ).rejects.toThrow();
  });
});