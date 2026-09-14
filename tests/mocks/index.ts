// The in-memory adapters moved to src/adapters/mock in Phase 12.5 (the concrete
// MVP fallback). Tests keep importing from tests/mocks — this barrel re-exports
// them so test code reads "test double" clearly, while src owns the adapters.
export { MockClock } from "@/adapters/mock/clock";
export { MockLlm, createMockLlm, mockLlm } from "@/adapters/mock/llm";
export type { MockLlmOptions } from "@/adapters/mock/llm";
export { scriptedModel } from "@/adapters/mock/sdk-model";
export type { ScriptedModelStep } from "@/adapters/mock/sdk-model";
export { MockStt, createMockStt, mockStt } from "@/adapters/mock/stt";
export type { MockSttOptions } from "@/adapters/mock/stt";
export { MockStoryWorldStore, createMockStoryWorldStore, mockStoryWorldStore } from "@/adapters/mock/story-world-store";
export type { MockStoryWorldStoreOptions } from "@/adapters/mock/story-world-store";
export { MockTranscriptStore, createMockTranscriptStore, mockTranscriptStore } from "@/adapters/mock/transcript-store";
export type { MockTranscriptStoreOptions } from "@/adapters/mock/transcript-store";
export { MockJobQueue, createMockJobQueue, mockJobQueue } from "@/adapters/mock/job-queue";