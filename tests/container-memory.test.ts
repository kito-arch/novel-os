import { describe, expect, it } from "vitest";
import { buildContainer } from "@/container";
import { loadConfig } from "@/config";
import type {
  AppRegistry,
  JobQueue,
  LlmClient,
  SpeechToText,
  StoryWorldStore,
  TranscriptStore,
} from "@/container";
import { buildMemoryContainer } from "./mocks/memory-container";

describe("Phase 4 composition root", () => {
  it("buildMemoryContainer wires the full AppRegistry memory container", async () => {
    const container = buildMemoryContainer();
    // Typed resolution: no casts anywhere.
    const stt: SpeechToText = container.get("STT");
    const llm: LlmClient = container.get("LLM");
    const store: StoryWorldStore = container.get("STORY_WORLD_STORE");
    const transcriptStore: TranscriptStore = container.get("TRANSCRIPT_STORE");
    const config = container.get("CONFIG");

    expect(container.get("LLM")).toBe(llm); // singletons within one container
    expect(config.LLM_PROVIDER).toBe("mock");
    expect(config.STT_PROVIDER).toBe("mock");

    const { jobId } = await stt.submitTranscription({
      audioBuffer: Buffer.from("x"),
      mimeType: "audio/mp3",
    });
    expect(jobId).toBe("mock-1");
    expect((await stt.getTranscript(jobId)).transcript).toBe("");
    expect(store).toBeDefined();
    expect(transcriptStore).toBeDefined();
  });

  it("each memory container is isolated (no state leaks between containers)", () => {
    const a = buildMemoryContainer();
    const b = buildMemoryContainer();
    expect(a).not.toBe(b);
    expect(a.get("STORY_WORLD_STORE")).not.toBe(b.get("STORY_WORLD_STORE"));
    expect(a.get("TRANSCRIPT_STORE")).not.toBe(b.get("TRANSCRIPT_STORE"));
    expect(a.get("JOB_QUEUE")).not.toBe(b.get("JOB_QUEUE"));
    expect(a.get("LLM")).not.toBe(b.get("LLM"));
  });

  it("buildContainer requires DATABASE_URL and errors descriptively for unshipped adapters", () => {
    // No DATABASE_URL → no production store exists; clear error at build time.
    expect(() =>
      buildContainer(loadConfig({ LLM_PROVIDER: "mock" })),
    ).toThrow(/DATABASE_URL/);

    // With DATABASE_URL the container builds with real Postgres adapters
    // (client construction does not connect, so no live DB is required here).
    const container = buildContainer(
      loadConfig({
        DATABASE_URL: "postgres://localhost:5432/novelos_test",
        LLM_PROVIDER: "mock",
      }),
    );
    expect(container.get("STORY_WORLD_STORE")).toBeDefined();
    expect(container.get("TRANSCRIPT_STORE")).toBeDefined();

    // Adapters that have not shipped resolve to phase-referencing errors.
    expect(() => container.get("STT")).toThrow(/AssemblyAI/);
    expect(() => container.get("LLM")).toThrow(/Phase 9/);
    expect(() => container.get("JOB_QUEUE")).toThrow(/SQS/);
  });

  it("wires the OpenAI LlmClient adapter when LLM_PROVIDER=openai (T9)", () => {
    const container = buildContainer(
      loadConfig({
        DATABASE_URL: "postgres://localhost:5432/novelos_test",
        LLM_PROVIDER: "openai",
        LLM_API_KEY: "test-key",
        LLM_BEST_MODEL: "gpt-5-pro-test",
      }),
    );
    const llm: LlmClient = container.get("LLM");
    expect(typeof llm.complete).toBe("function");
    expect(typeof llm.extractStructured).toBe("function");
  });

  it("wires the AssemblyAI STT adapter when STT_PROVIDER=assemblyai (T10)", () => {
    const container = buildContainer(
      loadConfig({
        DATABASE_URL: "postgres://localhost:5432/novelos_test",
        LLM_PROVIDER: "mock",
        STT_PROVIDER: "assemblyai",
        STT_API_KEY: "test-key",
      }),
    );
    const stt: SpeechToText = container.get("STT");
    expect(typeof stt.submitTranscription).toBe("function");
    expect(typeof stt.getJobStatus).toBe("function");
    expect(typeof stt.getTranscript).toBe("function");
  });

  it("wires the SQS JobQueue adapter when SQS_QUEUE_URL is set (T11)", () => {
    const container = buildContainer(
      loadConfig({
        DATABASE_URL: "postgres://localhost:5432/novelos_test",
        LLM_PROVIDER: "mock",
        SQS_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123/novelos-extraction",
        AWS_REGION: "us-east-1",
      }),
    );
    const queue: JobQueue = container.get("JOB_QUEUE");
    expect(typeof queue.enqueue).toBe("function");
    expect(typeof queue.onJobCompleted).toBe("function");
    expect(typeof queue.onJobFailed).toBe("function");
    expect(typeof queue.getStatus).toBe("function");
  });

  it("supports typed registry resolution for every port token", () => {
    const config: AppRegistry["CONFIG"] = loadConfig({ LLM_PROVIDER: "mock" });
    const container = buildMemoryContainer();
    expect(container.get("CLOCK").now()).toBeInstanceOf(Date);
    expect(typeof container.get("JOB_QUEUE").enqueue).toBe("function");
    expect(typeof container.get("LLM").complete).toBe("function");
    expect(typeof container.get("STT").submitTranscription).toBe("function");
    expect(config.LLM_CHEAP_MODEL).toBe("gpt-5-nano");
  });
});