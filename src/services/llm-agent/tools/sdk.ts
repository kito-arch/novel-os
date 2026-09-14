import { tool, zodSchema, type ToolSet } from "ai";
import type { StoryWorldStore } from "@/container/story-world-store";
import { STORY_TOOL_CATALOG, type StoryToolName } from "./definitions";
import { StoryToolExecutor } from "./executor";
import type { ExtractionSession } from "./session";

export interface StoryToolDeps {
  store: StoryWorldStore;
  session: ExtractionSession;
}

// Wraps the zod-schema tool catalog in AI SDK tools. Each tool's execute hands
// the validated input to the static executor, which owns the staging logic and
// budget counters. The SDK drives the loop; the executor stays provider-agnostic.
export function buildStoryTools(deps: StoryToolDeps): ToolSet {
  const entries = (Object.keys(STORY_TOOL_CATALOG) as StoryToolName[]).map((name) => {
    const definition = STORY_TOOL_CATALOG[name];
    return [
      name,
      tool({
        description: definition.description,
        inputSchema: zodSchema(definition.inputSchema),
        execute: async (input, options) =>
          StoryToolExecutor.execute(deps.store, deps.session, {
            id: options.toolCallId,
            name,
            arguments: input as Record<string, unknown>,
          }),
      }),
    ];
  });
  return Object.fromEntries(entries) as ToolSet;
}