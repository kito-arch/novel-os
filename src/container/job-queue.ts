export type JobStatus = "queued" | "processing" | "completed" | "failed";

// AssemblyAI's free tier permits 5 concurrent transcription jobs. The
// transcription worker's maxConcurrency must not exceed this value or
// submissions will be rejected with a 429. Upgrade the AssemblyAI plan
// before raising this constant.
export const ASSEMBLYAI_MAX_CONCURRENT = 5;

export interface TranscriptionJob {
  dictationId: string;
  audioKey: string;   // S3 key (prod) or local path (dev) written by AudioStorage.save()
  mimeType: string;
  webhookUrl: string; // assembled from request origin at enqueue time
}

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