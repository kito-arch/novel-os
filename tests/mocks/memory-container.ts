import { createContainer } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import type { EnvVars } from "@/config";
import { loadConfig } from "@/config";
import { SystemClock } from "@/adapters";
import { createAppModule } from "@/container";
import type { AppRegistry } from "@/container";
import {
  MockJobQueue,
  MockLlm,
  MockStt,
  MockStoryWorldStore,
  MockTranscriptStore,
} from "./index";

// Test/dev memory container: wires the mock adapters (which intentionally live
// in tests/mocks — they are test doubles, not production code). Each call
// creates fresh adapter instances so tests/requests never share leaked state;
// @evyweb/ioctopus keeps them singletons *within* one container.
export function buildMemoryContainer(env: EnvVars = {}): TypedContainer<AppRegistry> {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(loadConfig(env)));
  container.bind("CLOCK").toClass(SystemClock);
  container.bind("STT").toClass(MockStt);
  container.bind("LLM").toClass(MockLlm);
  container.bind("STORY_WORLD_STORE").toClass(MockStoryWorldStore);
  container.bind("TRANSCRIPT_STORE").toClass(MockTranscriptStore);
  container.bind("JOB_QUEUE").toClass(MockJobQueue);
  return container;
}