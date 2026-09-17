export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface ExtractionJob {
  dictationId: string;
  storyId: string;
  transcript: string;
  sceneId?: string | null;
  chapterId?: string | null;
  sceneTitle?: string | null;
  chapterTitle?: string | null;
}

// Provider-agnostic: production adapter is AWS SQS (fully managed), dev/test uses
// the in-memory adapter. SQS has no server-side rate limiter, so production wiring
// bounds the consumer's maxConcurrency to stay under AssemblyAI's account rate limit.
export interface JobQueue {
  enqueue<T>(jobName: string, data: T): Promise<{ jobId: string }>;
  onJobCompleted(jobName: string, handler: (data: unknown) => Promise<void>): void;
  onJobFailed(jobName: string, handler: (data: unknown, error: Error) => Promise<void>): void;
  getStatus(jobId: string): Promise<JobStatus>;
}