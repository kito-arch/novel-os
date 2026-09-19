import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createContainer } from "@evyweb/ioctopus";
import type {
  AppRegistry,
  Clock,
  ExtractionJob,
  ExtractionRequest,
  ExtractionResult,
  JobQueue,
  LlmClient,
  SpeechToText,
  StoryWorldStore,
  TranscriptStore,
} from "@/container";
import { createAppModule } from "@/container";
import { loadConfig } from "@/config";

const stubClock: Clock = {
  now: () => new Date("2026-01-01T00:00:00Z"),
  elapsed: () => false,
};

const stubStt: SpeechToText = {
  submitTranscription: async () => ({ jobId: "transcript_abc" }),
  getJobStatus: async () => ({ status: "completed", transcript: "hello" }),
  getTranscript: async () => ({ transcript: "hello", durationSeconds: 2 }),
};

const stubLlm: LlmClient = {
  complete: async () => ({ text: "ok", usage: { inputTokens: 1, outputTokens: 1 } }),
  extractStructured: async <T>(
    request: ExtractionRequest<T>,
  ): Promise<ExtractionResult<T>> => ({
    data: request.schema.parse({ ok: true }) as T,
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
};

const stubStoryWorldStore: StoryWorldStore = {
  listStories: async () => [],
  createStory: async () => {},
  getWorld: async () => null,
  updateStoryTitle: async () => {},
  updateStoryCover: async () => {},
  checkStoryOwner: async () => true,
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
  upsertEntityType: async () => randomUUID(),
  getEntityTypes: async () => [],
  findEntityTypeByName: async () => null,
  findEntityByName: async () => null,
  listEntities: async () => [],
  attachMedia: async () => randomUUID(),
  getMedia: async () => [],
  removeMedia: async () => {},
  insertKnowledge: async () => randomUUID(),
  getKnowledge: async () => [],
  listChapters: async () => [],
  createChapter: async () => randomUUID(),
  updateChapter: async () => {},
  deleteChapter: async () => {},
  listProseScenes: async () => [],
  getProseScene: async () => null,
  createProseScene: async () => randomUUID(),
  updateProseScene: async () => {},
  deleteProseScene: async () => {},
  deleteEntity: async () => {},
  deleteEvent: async () => {},
  updateEvent: async () => {},
  createEvent: async () => randomUUID(),
};

const stubTranscriptStore: TranscriptStore = {
  saveDictation: async () => randomUUID(),
  getDictation: async () => null,
  findDictationByProviderJobId: async () => null,
  updateDictation: async () => {},
  listDictations: async () => [],
};

const stubJobQueue: JobQueue = {
  enqueue: async () => ({ jobId: "job_1" }),
  onJobCompleted: () => {},
  onJobFailed: () => {},
  getStatus: async () => "completed",
};

describe("container registry (Phase 2 ports)", () => {
  it("AppRegistry declares every port token and resolves it typed", () => {
    const container = createContainer<AppRegistry>();
    container.load("app", createAppModule(loadConfig({ LLM_PROVIDER: "mock" })));

    container.bind("CLOCK").toValue(stubClock);
    container.bind("STT").toValue(stubStt);
    container.bind("LLM").toValue(stubLlm);
    container.bind("STORY_WORLD_STORE").toValue(stubStoryWorldStore);
    container.bind("TRANSCRIPT_STORE").toValue(stubTranscriptStore);
    container.bind("TRANSCRIPTION_QUEUE").toValue(stubJobQueue);
    container.bind("EXTRACTION_QUEUE").toValue(stubJobQueue);
    container.bind("AUDIO_STORAGE").toValue({ save: async () => ({ url: "/u", key: "k" }), loadBuffer: async () => Buffer.alloc(0) });

    expect(container.get("CLOCK")).toBe(stubClock);
    expect(container.get("STT")).toBe(stubStt);
    expect(container.get("LLM")).toBe(stubLlm);
    expect(container.get("STORY_WORLD_STORE")).toBe(stubStoryWorldStore);
    expect(container.get("TRANSCRIPT_STORE")).toBe(stubTranscriptStore);
    expect(container.get("TRANSCRIPTION_QUEUE")).toBe(stubJobQueue);
    expect(container.get("EXTRACTION_QUEUE")).toBe(stubJobQueue);
  });

  it("port types are importable from @/container (registry acceptance)", () => {
    const job: ExtractionJob = { dictationId: "x", storyId: "y", transcript: "" };
    expect(job.storyId).toBe("y");
  });
});