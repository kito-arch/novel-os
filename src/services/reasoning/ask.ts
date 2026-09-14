import type { LlmClient } from "@/container/llm";
import type { StoryWorldStore } from "@/container/story-world-store";
import { buildContext, renderContextPackage } from "@/services/context/builder";
import { parseMentions } from "@/services/context/mention-parser";

export interface AskStoryDeps {
  store: StoryWorldStore;
  llm: LlmClient;
}

// Bound service shape in the application container (ASK_STORY token).
export type AskStory = (storyId: string, question: string) => Promise<string>;

const SYSTEM_PROMPT = [
  "You are a story-scribe assistant for a novel-writing app.",
  "Answer the user's question about the enclosed story world using ONLY the provided context.",
  'If the context does not contain the answer, say "I don\'t know" rather than inventing details.',
  "Quote element names exactly as written. Keep the answer concise and grounded in the context.",
].join("\n");

// T7.1 — "Ask my story anything". Mentions in the question resolve against the
// world (T6.3), the named entities' bounded context is assembled (T6.1), and a
// standard-tier LLM completes the answer from that context only.
export async function askStory(
  deps: AskStoryDeps,
  storyId: string,
  question: string,
): Promise<string> {
  if (!question.trim()) {
    throw new Error("question must not be empty");
  }
  const world = await deps.store.getWorld(storyId);
  if (!world) throw new Error(`story ${storyId} not found`);

  const mentions = parseMentions(question, world.entities);
  const context = await buildContext(deps.store, storyId, mentions);
  const { text } = await deps.llm.complete({
    tier: "standard",
    temperature: 0.2,
    systemPrompt: SYSTEM_PROMPT,
    userMessage: `${renderContextPackage(context)}\n\nQUESTION:\n${question}`,
  });
  return text.trim();
}