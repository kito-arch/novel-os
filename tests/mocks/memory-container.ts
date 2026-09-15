import { createContainer } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import { SystemClock } from "@/adapters";
import { createAppModule, NotImplementedError } from "@/container";
import type { AppRegistry } from "@/container";
import { loadConfig } from "@/config";
import { askStory } from "@/services/reasoning/ask";
import { checkContinuity } from "@/services/reasoning/continuity";
import { doesEntityKnow } from "@/services/reasoning/knowledge";
import { MockJobQueue } from "./job-queue";
import { MockLlm } from "./llm";
import { MockStt } from "./stt";
import { MockStoryWorldStore } from "./story-world-store";
import { MockTranscriptStore } from "./transcript-store";

// In-memory container for tests: wires all mock adapters (no Postgres/LLM/STT/SQS keys
// needed). Each call returns a fully independent container — no shared state between tests.
export function buildMemoryContainer(): TypedContainer<AppRegistry> {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(loadConfig({ LLM_PROVIDER: "mock" })));
  container.bind("CLOCK").toClass(SystemClock);
  container.bind("STT").toClass(MockStt);
  container.bind("LLM").toClass(MockLlm);
  container.bind("STORY_WORLD_STORE").toClass(MockStoryWorldStore);
  container.bind("TRANSCRIPT_STORE").toClass(MockTranscriptStore);
  container.bind("JOB_QUEUE").toClass(MockJobQueue);
  container.bind("TRANSCRIPT_PROCESSOR").toFactory(() => {
    throw new NotImplementedError(
      "TRANSCRIPT_PROCESSOR is not available in the memory container. " +
        "Construct TranscriptProcessor directly with a scriptedModel (tests/mocks/sdk-model.ts).",
    );
  });
  container.bind("ASK_STORY").toFactory(
    (resolve) => (storyId: string, question: string) =>
      askStory(
        { store: resolve("STORY_WORLD_STORE"), llm: resolve("LLM") },
        storyId,
        question,
      ),
  );
  container.bind("KNOWLEDGE_QUERY").toFactory(
    (resolve) => (
      storyId: string,
      entityId: string,
      factDescription: string,
      timeline?: string | null,
    ) => doesEntityKnow(resolve("STORY_WORLD_STORE"), storyId, entityId, factDescription, timeline),
  );
  container.bind("CONTINUITY_CHECKER").toFactory(
    (resolve) => (storyId: string, analysisType: Parameters<typeof checkContinuity>[2]) =>
      checkContinuity(
        { store: resolve("STORY_WORLD_STORE"), llm: resolve("LLM") },
        storyId,
        analysisType,
      ),
  );
  return container;
}

// Pre-built singleton for tests that don't need isolation (read-only assertions).
export const memoryContainer = buildMemoryContainer();
