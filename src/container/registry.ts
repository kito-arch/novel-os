import type { AppConfig } from "../config";
import type { TranscriptProcessor } from "../services/llm-agent/transcript-processor";
import type { AskStory } from "../services/reasoning/ask";
import type { ContinuityChecker } from "../services/reasoning/continuity";
import type { KnowledgeQuery } from "../services/reasoning/knowledge";
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
  TRANSCRIPT_PROCESSOR: TranscriptProcessor;
  // Reasoning layer (Phases 6–7): bound services backing the ask/analyze/
  // knowledge endpoints. Each is a plain function closing over the stores and
  // the LlmClient port.
  ASK_STORY: AskStory;
  KNOWLEDGE_QUERY: KnowledgeQuery;
  CONTINUITY_CHECKER: ContinuityChecker;
};