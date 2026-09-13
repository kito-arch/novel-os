import type { AppConfig } from "../config";
import type { Clock } from "./clock";
import type { JobQueue } from "./job-queue";
import type { LlmClient } from "./llm";
import type { SpeechToText } from "./stt";
import type { StoryWorldStore } from "./story-world-store";
import type { TranscriptStore } from "./transcript-store";

export * from "./clock";
export * from "./job-queue";
export * from "./llm";
export * from "./stt";
export * from "./story-world-store";
export * from "./transcript-store";

export type AppRegistry = {
  CONFIG: AppConfig;
  STT: SpeechToText;
  LLM: LlmClient;
  STORY_WORLD_STORE: StoryWorldStore;
  TRANSCRIPT_STORE: TranscriptStore;
  JOB_QUEUE: JobQueue;
  CLOCK: Clock;
};