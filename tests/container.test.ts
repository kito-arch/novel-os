import { describe, expect, it } from "vitest";
import { createContainer } from "@evyweb/ioctopus";
import type { AppRegistry, StoryWorldStore } from "@/container";
import { createLanguageModel } from "@/adapters";
import { TranscriptProcessor } from "@/services/llm-agent/transcript-processor";
import { NotImplementedError, buildContainer, createAppModule } from "@/container";
import { loadConfig } from "@/config";

const stubStoryWorldStore: StoryWorldStore = {
  listStories: async () => [],
  createStory: async () => {},
  getWorld: async () => null,
  updateStoryTitle: async () => {},
  updateStoryCover: async () => {},
  commit: async () => ({
    revision: 1,
    entityTypesCreated: 0,
    entitiesCreated: 0,
    entitiesUpdated: 0,
    entitiesCreatedByType: {},
    eventsAdded: 0,
    factsAdded: 0,
    relationshipsAdded: 0,
    knowledgeAdded: 0,
    scenesAdded: 0,
    plotThreadsUpdated: 0,
    openQuestionsAdded: 0,
    openQuestionsResolved: 0,
    contradictionsFound: 0,
    factsSuperseded: 0,
  }),
  getEntity: async () => null,
  queryEvents: async () => [],
  byRevision: async () => null,
  upsertEntityType: async () => "type-1",
  getEntityTypes: async () => [],
  findEntityTypeByName: async () => null,
  findEntityByName: async () => null,
  listEntities: async () => [],
  attachMedia: async () => "media-1",
  getMedia: async () => [],
  removeMedia: async () => {},
  insertKnowledge: async () => "knowledge-1",
  getKnowledge: async () => [],
  listChapters: async () => [],
  createChapter: async () => "chapter-1",
  updateChapter: async () => {},
  deleteChapter: async () => {},
  listProseScenes: async () => [],
  getProseScene: async () => null,
  createProseScene: async () => "scene-1",
  updateProseScene: async () => {},
  deleteProseScene: async () => {},
  deleteEntity: async () => {},
  deleteEvent: async () => {},
  updateEvent: async () => {},
  createEvent: async () => "event-1",
};

describe("ioctopus container", () => {
  it("binds CONFIG as a value and resolves it typed", () => {
    const config = loadConfig({ LLM_PROVIDER: "mock" });
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(config));
    expect(container.get("CONFIG")).toBe(config);
  });

  it("loads an app module into a fresh typed container", () => {
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(loadConfig({ LLM_PROVIDER: "mock" })));
    expect(container.get("CONFIG").LLM_PROVIDER).toBe("mock");
    expect(container.get("CONFIG").STT_PROVIDER).toBe("mock");
  });

  it("buildContainer reads process.env but has no production adapters yet", () => {
    expect(() =>
      buildContainer(loadConfig({ LLM_PROVIDER: "mock" })),
    ).toThrow(NotImplementedError);
  });

  it("wires TRANSCRIPT_PROCESSOR with container-injected deps (model + story store)", async () => {
    // Mirrors the buildContainer composition (buildContainer itself throws
    // NotImplementedError until the STT adapter ships).
    const container = createContainer<AppRegistry>();
    container.load(
      "app",
      createAppModule(loadConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" })),
    );
    container.bind("CLOCK").toValue({ now: () => new Date(), elapsed: () => false });
    container.bind("STORY_WORLD_STORE").toValue(stubStoryWorldStore);
    container
      .bind("TRANSCRIPT_PROCESSOR")
      .toFactory((resolve) => new TranscriptProcessor({ model: createLanguageModel(resolve("CONFIG")), store: resolve("STORY_WORLD_STORE") }));

    const processor: AppRegistry["TRANSCRIPT_PROCESSOR"] =
      container.get("TRANSCRIPT_PROCESSOR");
    expect(processor).toBeInstanceOf(TranscriptProcessor);

    // Same token resolves the same instance (singleton within one container).
    expect(container.get("TRANSCRIPT_PROCESSOR")).toBe(processor);

    // Empty transcript → no-op; never calls the model.
    const result = await processor.process({
      storyId: "s",
      dictationId: "d",
      transcript: "   ",
    });
    expect(result.chunks).toHaveLength(0);
    expect(result.commitResults).toHaveLength(0);
  });
});