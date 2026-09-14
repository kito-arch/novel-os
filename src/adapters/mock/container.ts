import { createContainer } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import type { EnvVars } from "@/config";
import { loadConfig } from "@/config";
import { SystemClock } from "@/adapters";
import { createAppModule } from "@/container";
import type { AppRegistry } from "@/container";
import { askStory } from "@/services/reasoning/ask";
import { checkContinuity } from "@/services/reasoning/continuity";
import { doesEntityKnow } from "@/services/reasoning/knowledge";
import {
  MockJobQueue,
  MockLlm,
  MockStt,
  MockStoryWorldStore,
  MockTranscriptStore,
} from "./index";

// Dev container ("local-fallback" for providers): wires the in-memory mock
// adapters so `next dev` resolves every API route without external keys (no
// LLM/STT/Postgres/SQS). The world + dictation stores are in-memory, so reads
// (story bible, character/scene detail, reasoning endpoints) work against a
// fresh empty universe; the dictation/extraction loop intentionally stays inert
// (the AssemblyAI webhook never fires and no queue consumer runs) — tests drive
// that pipeline directly via the webhook route + mock queue handlers. One
// container per build call keeps adapter instances singletons *within* it;
// `resolveContainer` holds one instance for the whole dev server, so world
// state survives across requests and resets on restart. Forces
// LLM_PROVIDER=mock: this container only ever wires test doubles, while real
// runs resolve an actual LanguageModel via the config default.
export function buildDevContainer(env: EnvVars = {}): TypedContainer<AppRegistry> {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(loadConfig({ LLM_PROVIDER: "mock", ...env })));
  container.bind("CLOCK").toClass(SystemClock);
  container.bind("STT").toClass(MockStt);
  container.bind("LLM").toClass(MockLlm);
  container.bind("STORY_WORLD_STORE").toClass(MockStoryWorldStore);
  container.bind("TRANSCRIPT_STORE").toClass(MockTranscriptStore);
  container.bind("JOB_QUEUE").toClass(MockJobQueue);
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