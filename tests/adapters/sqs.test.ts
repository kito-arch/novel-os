import { describe, expect, it, vi } from "vitest";
import type { SQSClient } from "@aws-sdk/client-sqs";
import { SqsJobQueue, type SqsJobQueueOptions } from "@/adapters/sqs";

interface FakeMessage {
  id: string;
  body: string;
  jobName: string;
}

// Minimal fake of the AWS SQS client: routes commands by constructor name and
// transitions messages queued → in-flight → deleted, recording each op.
class FakeSqs {
  queued: FakeMessage[] = [];
  readonly deletedReceiptHandles: string[] = [];
  readonly dlqMessages: FakeMessage[] = [];
  failNext = false;
  private counter = 0;

  async execute(command: {
    constructor: { name: string };
    input: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("sqs unreachable");
    }

    const input = command.input as {
      QueueUrl?: string;
      MessageBody?: string;
      MessageAttributes?: { jobName?: { StringValue?: string } };
      MaxNumberOfMessages?: number;
      ReceiptHandle?: string;
    };

    switch (command.constructor.name) {
      case "SendMessageCommand": {
        const message: FakeMessage = {
          id: `msg-${(this.counter += 1)}`,
          body: input.MessageBody ?? "",
          jobName: input.MessageAttributes?.jobName?.StringValue ?? "",
        };
        if (input.QueueUrl?.endsWith("/dlq")) this.dlqMessages.push(message);
        else this.queued.push(message);
        return { MessageId: message.id };
      }
      case "ReceiveMessageCommand": {
        const count = Math.min(input.MaxNumberOfMessages ?? 10, this.queued.length);
        const batch = this.queued.splice(0, count);
        return {
          Messages: batch.map((message) => ({
            MessageId: message.id,
            Body: message.body,
            ReceiptHandle: `rh-${message.id}`,
            MessageAttributes: { jobName: { StringValue: message.jobName } },
          })),
        };
      }
      case "DeleteMessageCommand": {
        this.deletedReceiptHandles.push(input.ReceiptHandle ?? "");
        return {};
      }
      default:
        return {};
    }
  }
}

// The adapter is typed against the real SQSClient; the fake is cast to it.
// Its execution path lives in execute(), invoked through the send() bypass we
// install at build time.
function buildQueue(fake: FakeSqs, overrides: Partial<SqsJobQueueOptions> = {}): SqsJobQueue {
  const client = {
    send: (command: unknown): Promise<Record<string, unknown>> =>
      fake.execute(command as { constructor: { name: string }; input: Record<string, unknown> }),
  } as unknown as SQSClient;

  return new SqsJobQueue({
    queueUrl: "https://sqs.test/main",
    client,
    longPollSeconds: 0,
    maxConcurrency: 2,
    logger: () => {},
    ...overrides,
  });
}

async function waitForStatus(queue: SqsJobQueue, jobId: string, status: string): Promise<void> {
  await vi.waitFor(async () => {
    expect(await queue.getStatus(jobId)).toBe(status);
  });
}

describe("SqsJobQueue (T11.1)", () => {
  it("enqueues a { jobName, data } message to the configured queue", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake);

    const { jobId } = await queue.enqueue("extraction", { dictationId: "d1" });

    expect(jobId).toBe("msg-1");
    expect(fake.queued).toHaveLength(1);
    const [message] = fake.queued;
    expect(JSON.parse(message.body)).toEqual({ jobName: "extraction", data: { dictationId: "d1" } });
    expect(message.jobName).toBe("extraction");
    expect(await queue.getStatus(jobId)).toBe("queued");
  });

  it("round-trips enqueue + onJobCompleted and deletes the message", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake);
    const handled: unknown[] = [];
    queue.onJobCompleted("extraction", async (data) => {
      handled.push(data);
    });

    const { jobId } = await queue.enqueue("extraction", { dictationId: "d1" });
    queue.start();
    await waitForStatus(queue, jobId, "completed");

    expect(handled).toEqual([{ dictationId: "d1" }]);
    expect(fake.deletedReceiptHandles).toContain(`rh-${jobId}`);
    await queue.stop();
  });

  it("routes handler failures to onJobFailed, deletes the message and marks failed", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake);
    const failed: Array<{ data: unknown; error: Error }> = [];
    queue.onJobCompleted("extraction", async () => {
      throw new Error("boom");
    });
    queue.onJobFailed("extraction", async (data, error) => {
      failed.push({ data, error });
    });

    const { jobId } = await queue.enqueue("extraction", { dictationId: "d1" });
    queue.start();
    await waitForStatus(queue, jobId, "failed");

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ data: { dictationId: "d1" } });
    expect(failed[0].error.message).toBe("boom");
    expect(fake.deletedReceiptHandles).toContain(`rh-${jobId}`);
    await queue.stop();
  });

  it("moves failed jobs to the DLQ when configured", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake, { dlqUrl: "https://sqs.test/dlq" });
    queue.onJobCompleted("extraction", async () => {
      throw new Error("boom");
    });

    const { jobId } = await queue.enqueue("extraction", { dictationId: "d1" });
    queue.start();
    await waitForStatus(queue, jobId, "failed");

    expect(fake.dlqMessages).toHaveLength(1);
    expect(fake.dlqMessages[0].jobName).toBe("extraction");
    await queue.stop();
  });

  it("adheres to maxConcurrency under a burst of jobs", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake, { maxConcurrency: 2 });
    let inFlight = 0;
    let peak = 0;
    let completed = 0;
    queue.onJobCompleted("extraction", async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      completed += 1;
    });

    queue.start();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const { jobId } = await queue.enqueue("extraction", { i });
      ids.push(jobId);
    }
    await vi.waitFor(() => expect(completed).toBe(5));

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
    await queue.stop();
  });

  it("abandons messages for unknown job types", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake);

    const { jobId } = await queue.enqueue("unknown-job", { x: 1 });
    queue.start();
    await waitForStatus(queue, jobId, "failed");

    expect(fake.deletedReceiptHandles).toContain(`rh-${jobId}`);
    await queue.stop();
  });

  it("falls back to the in-process queue for local dev when resilience=local-fallback", async () => {
    const fake = new FakeSqs();
    const queue = buildQueue(fake, { resilience: "local-fallback" });
    fake.failNext = true;
    const handled: unknown[] = [];
    queue.onJobCompleted("extraction", async (data) => {
      handled.push(data);
    });

    const { jobId } = await queue.enqueue("extraction", { dictationId: "d1" });
    await vi.waitFor(() => expect(handled).toEqual([{ dictationId: "d1" }]));
    expect(await queue.getStatus(jobId)).toBe("completed");
  });

  it("throws on connection failure in strict mode", async () => {
    const fake = new FakeSqs();
    fake.failNext = true;
    const queue = buildQueue(fake, { resilience: "strict" });

    await expect(queue.enqueue("extraction", { dictationId: "d1" })).rejects.toThrow(
      "sqs unreachable",
    );
  });
});