import { randomUUID } from "node:crypto";
import type { JobQueue, JobStatus } from "@/container/job-queue";

type CompletedHandler = (data: unknown) => Promise<void>;
type FailedHandler = (data: unknown, error: Error) => Promise<void>;

interface QueuedJob {
  jobName: string;
  data: unknown;
  status: JobStatus;
}

// Synchronous in-memory JobQueue: enqueue immediately invokes the registered
// handler for that job name — handy for deterministic full-pipeline tests.
// If no handler is registered the job stays queued. No leak between queues:
// create a fresh instance per test (or container).
export class MockJobQueue implements JobQueue {
  private readonly completedHandlers = new Map<string, CompletedHandler>();
  private readonly failedHandlers = new Map<string, FailedHandler>();
  private readonly jobs = new Map<string, QueuedJob>();
  // Appends every enqueue so tests can assert extraction jobs' payloads.
  readonly enqueued: Array<{ jobName: string; data: unknown }> = [];

  onJobCompleted(jobName: string, handler: CompletedHandler): void {
    this.completedHandlers.set(jobName, handler);
  }

  onJobFailed(jobName: string, handler: FailedHandler): void {
    this.failedHandlers.set(jobName, handler);
  }

  async enqueue<T>(jobName: string, data: T): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    this.jobs.set(jobId, { jobName, data, status: "queued" });
    this.enqueued.push({ jobName, data });

    const handler = this.completedHandlers.get(jobName);
    if (!handler) return { jobId };

    this.jobs.set(jobId, { jobName, data, status: "processing" });
    try {
      await handler(data);
      this.jobs.set(jobId, { jobName, data, status: "completed" });
    } catch (error) {
      const failed = this.failedHandlers.get(jobName);
      if (failed) await failed(data, error as Error);
      this.jobs.set(jobId, { jobName, data, status: "failed" });
    }
    return { jobId };
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    return this.jobs.get(jobId)?.status ?? "queued";
  }
}

export function createMockJobQueue(): JobQueue {
  return new MockJobQueue();
}

export const mockJobQueue = new MockJobQueue();