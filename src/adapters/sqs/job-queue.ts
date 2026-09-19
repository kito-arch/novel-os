import { randomUUID } from "node:crypto";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { JobQueue, JobStatus } from "@/container/job-queue";

export interface SqsJobQueueOptions {
  queueUrl: string;
  // Injectable AWS SQS client (tests pass a fake); also the resilience point:
  // when it fails and resilience="local-fallback", the adapter degrades to an
  // in-process queue so local dev keeps working without a live queue.
  client: SQSClient;
  maxConcurrency?: number;
  dlqUrl?: string;
  visibilityTimeoutSeconds?: number;
  longPollSeconds?: number;
  resilience?: "strict" | "local-fallback";
  logger?: (line: string) => void;
}

type CompletedHandler = (data: unknown) => Promise<void>;
type FailedHandler = (data: unknown, error: Error) => Promise<void>;

interface SqsMessage {
  id: string;
  body: string;
  receiptHandle: string;
  jobName: string;
}

// In-process fallback queue for dev: processes jobs asynchronously (fire-and-
// forget) to mirror production SQS behaviour. Lives here (not tests/mocks)
// because it is a reachable branch of the production adapter, not a test double.
// Exported as InMemoryJobQueue for direct use when no SQS URL is configured.
export class InMemoryJobQueue implements JobQueue {
  private readonly completed = new Map<string, CompletedHandler>();
  private readonly failed = new Map<string, FailedHandler>();
  private readonly status = new Map<string, JobStatus>();

  onJobCompleted(name: string, handler: CompletedHandler): void {
    this.completed.set(name, handler);
  }

  onJobFailed(name: string, handler: FailedHandler): void {
    this.failed.set(name, handler);
  }

  enqueue<T>(jobName: string, data: T): Promise<{ jobId: string }> {
    const jobId = `local-${Math.random().toString(36).slice(2)}`;
    this.status.set(jobId, "processing");
    const handler = this.completed.get(jobName);
    if (!handler) {
      this.status.set(jobId, "queued");
      return Promise.resolve({ jobId });
    }
    // Fire-and-forget: mirrors production SQS behaviour where enqueue returns
    // immediately and the consumer processes the message asynchronously.
    void handler(data).then(
      () => { this.status.set(jobId, "completed"); },
      async (error) => {
        const failed = this.failed.get(jobName);
        if (failed) await failed(data, error as Error);
        this.status.set(jobId, "failed");
      },
    );
    return Promise.resolve({ jobId });
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    return this.status.get(jobId) ?? "queued";
  }
}

// T11.1 — SQS-backed JobQueue. enqueue sends a JSON { jobName, data } message
// (jobName also duplicated as a message attribute for routing robustness). The
// consumer long-polls ReceiveMessage, dispatches to the registered handler under
// a maxConcurrency bound — the AssemblyAI account rate limit control — deletes
// processed messages, and moves failed jobs to the DLQ when one is configured.
// Polling is started explicitly via start() (workers only); webhook/API routes
// use the adapter purely for enqueue.
export class SqsJobQueue implements JobQueue {
  private readonly queueUrl: string;
  private readonly client: SQSClient;
  private readonly maxConcurrency: number;
  private readonly dlqUrl?: string;
  private readonly visibilityTimeoutSeconds: number;
  private readonly longPollSeconds: number;
  private readonly resilience: "strict" | "local-fallback";
  private readonly logger: (line: string) => void;

  private readonly completed = new Map<string, CompletedHandler>();
  private readonly failed = new Map<string, FailedHandler>();
  private readonly statuses = new Map<string, JobStatus>();

  private active = 0;
  private readonly pendingAcquires: Array<() => void> = [];
  private running = false;
  private polling: Promise<void> | undefined;
  private fallback: InMemoryJobQueue | null = null;

  constructor(options: SqsJobQueueOptions) {
    this.queueUrl = options.queueUrl;
    this.client = options.client;
    this.maxConcurrency = options.maxConcurrency ?? 10;
    this.dlqUrl = options.dlqUrl;
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 60;
    this.longPollSeconds = options.longPollSeconds ?? 20;
    this.resilience = options.resilience ?? "strict";
    this.logger = options.logger ?? (() => {});
  }

  onJobCompleted(jobName: string, handler: CompletedHandler): void {
    this.completed.set(jobName, handler);
    this.fallback?.onJobCompleted(jobName, handler);
  }

  onJobFailed(jobName: string, handler: FailedHandler): void {
    this.failed.set(jobName, handler);
    this.fallback?.onJobFailed(jobName, handler);
  }

  async enqueue<T>(jobName: string, data: T): Promise<{ jobId: string }> {
    if (this.fallback) return this.fallback.enqueue(jobName, data);
    try {
      const response = await this.client.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({ jobName, data }),
          MessageAttributes: { jobName: { DataType: "String", StringValue: jobName } },
        }),
      );
      const jobId = response.MessageId ?? `sqs-${Date.now()}`;
      this.statuses.set(jobId, "queued");
      return { jobId };
    } catch (error) {
      if (this.resilience === "local-fallback") return this.degradeAndEnqueue(jobName, data, error);
      throw error;
    }
  }

  async getStatus(jobId: string): Promise<JobStatus> {
    if (this.fallback) return this.fallback.getStatus(jobId);
    return this.statuses.get(jobId) ?? "queued";
  }

  // Consumer bootstrap (worker entry point only). Safe to call again: no-op.
  start(): void {
    if (this.running || this.polling) return;
    this.running = true;
    this.polling = this.pollLoop().finally(() => {
      this.running = false;
      this.polling = undefined;
    });
  }

  // Graceful shutdown: stop polling and wait for in-flight handlers to finish.
  async stop(): Promise<void> {
    this.running = false;
    await this.polling;
  }

  private async degradeAndEnqueue(jobName: string, data: unknown, error: unknown): Promise<{ jobId: string }> {
    this.logger(
      `[SqsJobQueue] SQS connection failed (${error instanceof Error ? error.message : String(error)}); ` +
        "falling back to the in-process queue for local dev.",
    );
    this.fallback = new InMemoryJobQueue();
    for (const [name, handler] of this.completed) this.fallback.onJobCompleted(name, handler);
    for (const [name, handler] of this.failed) this.fallback.onJobFailed(name, handler);
    return this.fallback.enqueue(jobName, data);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      const received = await this.pollOnce();
      // WaitTimeSeconds=0 (short poll) returns immediately; yield to the event
      // loop before the next receive so timers/other work aren't starved.
      if (!received && this.longPollSeconds <= 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async pollOnce(): Promise<boolean> {
    let messages: SqsMessage[];
    try {
      const response = await this.client.send(
        new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: Math.min(10, this.maxConcurrency),
          WaitTimeSeconds: this.longPollSeconds,
          VisibilityTimeout: this.visibilityTimeoutSeconds,
          MessageAttributeNames: ["jobName"],
        }),
      );
      messages = (response.Messages ?? []).map((message) => ({
        id: message.MessageId ?? randomUUID(),
        body: message.Body ?? "",
        receiptHandle: message.ReceiptHandle ?? "",
        jobName: message.MessageAttributes?.jobName?.StringValue ?? "",
      }));
    } catch (error) {
      if (this.resilience === "local-fallback") {
        this.logger(
          `[SqsJobQueue] ReceiveMessage failed (${error instanceof Error ? error.message : String(error)}); ` +
            "stopping the poll loop (in-process fallback active).",
        );
        this.running = false;
        return false;
      }
      throw error;
    }

    await Promise.all(messages.map((message) => this.dispatch(message)));
    return messages.length > 0;
  }

  private async dispatch(message: SqsMessage): Promise<void> {
    await this.acquire();
    try {
      await this.handle(message);
    } finally {
      this.release();
    }
  }

  private async handle(message: SqsMessage): Promise<void> {
    let jobName = message.jobName;
    let data: unknown = undefined;
    try {
      const parsed = JSON.parse(message.body) as { jobName?: string; data?: unknown };
      jobName = jobName || (parsed.jobName ?? "");
      data = parsed.data;
    } catch {
      // Body ignored; jobName must come from the message attribute instead.
    }

    this.statuses.set(message.id, "processing");
    const handler = this.completed.get(jobName);
    if (!handler) {
      this.logger(`[SqsJobQueue] No handler for job "${jobName}"; abandoning message ${message.id}.`);
      await this.discard(message);
      this.statuses.set(message.id, "failed");
      return;
    }

    try {
      await handler(data);
      this.statuses.set(message.id, "completed");
      await this.delete(message);
    } catch (error) {
      const failedHandler = this.failed.get(jobName);
      if (failedHandler) await failedHandler(data, error as Error);
      await this.discard(message);
      this.statuses.set(message.id, "failed");
    }
  }

  // Failed jobs go to the DLQ when configured; otherwise the message is deleted
  // (avoiding a poison-message loop). Retrying via visibility timeout is opt-in
  // by not configuring a DLQ.
  private async discard(message: SqsMessage): Promise<void> {
    if (this.dlqUrl) {
      try {
        await this.client.send(
          new SendMessageCommand({
            QueueUrl: this.dlqUrl,
            MessageBody: message.body,
            MessageAttributes: { jobName: { DataType: "String", StringValue: message.jobName } },
          }),
        );
      } catch (error) {
        this.logger(`[SqsJobQueue] DLQ send failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await this.delete(message);
  }

  private async delete(message: SqsMessage): Promise<void> {
    if (!message.receiptHandle) return;
    try {
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.receiptHandle }),
      );
    } catch (error) {
      this.logger(`[SqsJobQueue] DeleteMessage failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.pendingAcquires.push(resolve);
    });
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.pendingAcquires.shift();
    if (next) next();
    else this.active = Math.max(0, this.active);
  }
}

export function sqsQueue(options: SqsJobQueueOptions): JobQueue {
  return new SqsJobQueue(options);
}