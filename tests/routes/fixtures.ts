import { randomUUID } from "node:crypto";
import { createContainer } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import type { AppRegistry } from "@/container";
import type { Commit } from "@/domain/commits";
import type { EntityType } from "@/domain";
import type { Entity } from "@/domain/entities";
import { createAppModule } from "@/container";
import { loadConfig, type EnvVars } from "@/config";
import type { SpeechToText } from "@/container/stt";
import { MockAudioStorage, MockJobQueue, MockLlm, MockStoryWorldStore, MockStt, MockTranscriptStore } from "../mocks";
import { askStory } from "@/services/reasoning/ask";
import { doesEntityKnow } from "@/services/reasoning/knowledge";
import { checkContinuity } from "@/services/reasoning/continuity";

export const TEST_USER_ID = "test-user-001";

export interface FixtureWorld {
  container: TypedContainer<AppRegistry>;
  storyId: string;
  testUserId: string;
  characterType: EntityType;
  sarah: Entity;
  kaden: Entity;
}

export interface SetupOptions {
  llm?: MockLlm;
  stt?: SpeechToText;
  config?: EnvVars;
}

// Builds a fresh memory container with a seeded character world (two characters,
// knowledge, facts, event). Route tests call setup() before every test so each
// case gets an isolated store. Containers are never reused across tests.
export async function setup(opts?: SetupOptions): Promise<FixtureWorld> {
  const storyId = randomUUID();
  const store = new MockStoryWorldStore();

  const characterType: EntityType = {
    id: randomUUID(),
    storyId,
    name: "character",
    pluralName: "characters",
    baseKind: "character",
    description: "People in the story",
    attributeDefs: [
      { key: "goals", label: "Goals", kind: "text", required: false, multi: false },
    ],
    origin: "extracted",
    supersededBy: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const sarah: Entity = {
    id: randomUUID(),
    storyId,
    entityTypeId: characterType.id,
    name: "Sarah",
    aliases: [],
    attributes: {},
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const kaden: Entity = {
    id: randomUUID(),
    storyId,
    entityTypeId: characterType.id,
    name: "Kaden",
    aliases: [],
    attributes: {},
    media: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const commitPayload: Commit = {
    storyId,
    appliedFromRevision: 0,
    newEntityTypes: [characterType],
    entities: [sarah, kaden],
    entityUpdates: [],
    events: [],
    facts: [],
    relationships: [],
    knowledge: [],
    scenes: [],
    plotThreads: [],
    openQuestions: [],
    resolvedOpenQuestionIds: [],
    contradictions: [],
    supersedeFactIds: [],
  };
  await store.createStory(storyId, { title: "Test Story", ownerId: TEST_USER_ID });
  await store.commit(commitPayload);

  await store.insertKnowledge(storyId, {
    subjectEntityId: sarah.id,
    factId: null,
    knowledgeText: "Sarah killed Kaden in chapter 12",
    status: "known",
    learnedWhen: "chapter 12",
    learnedVia: "extraction",
  });

  const llm = opts?.llm ?? new MockLlm({ completions: { default: "Default mock answer" } });

  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(loadConfig({ LLM_PROVIDER: "mock", ...opts?.config })));
  container.bind("STORY_WORLD_STORE").toValue(store);
  container.bind("TRANSCRIPT_STORE").toValue(new MockTranscriptStore());
  container.bind("LLM").toValue(llm);
  container.bind("STT").toValue(opts?.stt ?? new MockStt());
  container.bind("AUDIO_STORAGE").toValue(new MockAudioStorage());
  container.bind("TRANSCRIPTION_QUEUE").toValue(new MockJobQueue());
  container.bind("EXTRACTION_QUEUE").toValue(new MockJobQueue());
  container.bind("ASK_STORY").toFactory(
    (resolve) => (sid: string, question: string) =>
      askStory({ store: resolve("STORY_WORLD_STORE"), llm: resolve("LLM") }, sid, question),
  );
  container.bind("KNOWLEDGE_QUERY").toFactory(
    (resolve) =>
      (sid: string, eid: string, factDescription: string, timeline?: string | null) =>
        doesEntityKnow(resolve("STORY_WORLD_STORE"), sid, eid, factDescription, timeline),
  );
  container.bind("CONTINUITY_CHECKER").toFactory(
    (resolve) =>
      (sid: string, analysisType: Parameters<typeof checkContinuity>[2]) =>
        checkContinuity({ store: resolve("STORY_WORLD_STORE"), llm: resolve("LLM") }, sid, analysisType),
  );

  return { container, storyId, testUserId: TEST_USER_ID, characterType, sarah, kaden };
}
