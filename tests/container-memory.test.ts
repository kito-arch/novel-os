import { describe, expect, it } from "vitest";
import { NotImplementedError, buildContainer } from "@/container";
import { loadConfig } from "@/config";
import type {
  AppRegistry,
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

  it("buildContainer throws a descriptive error for every unimplemented adapter", () => {
    // Real providers → phase-referencing error.
    expect(() =>
      buildContainer(loadConfig({ STT_PROVIDER: "assemblyai", STT_API_KEY: "k" })),
    ).toThrow(/AssemblyAI/);
    expect(() =>
      buildContainer(loadConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "k" })),
    ).toThrow(NotImplementedError);

    // Mock providers → no src mock adapter belongs in production; mocks live in tests.
    expect(() => buildContainer(loadConfig({}))).toThrow(
      /tests\/mocks/,
    );
    expect(() => buildContainer(loadConfig({ DATABASE_URL: "postgres://x" }))).toThrow(
      NotImplementedError,
    );
  });

  it("supports typed registry resolution for every port token", () => {
    const config: AppRegistry["CONFIG"] = loadConfig({});
    const container = buildMemoryContainer();
    expect(container.get("CLOCK").now()).toBeInstanceOf(Date);
    expect(typeof container.get("JOB_QUEUE").enqueue).toBe("function");
    expect(typeof container.get("LLM").chat).toBe("function");
    expect(typeof container.get("STT").submitTranscription).toBe("function");
    expect(config.LLM_CHEAP_MODEL).toBe("gpt-5-nano");
  });
});