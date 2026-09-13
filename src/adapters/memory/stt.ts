import type {
  SpeechToText,
  TranscribeRequest,
  TranscriptResult,
  TranscriptSegment,
  TranscriptionStatus,
} from "../../container/stt";

// Deterministic in-memory SpeechToText adapter: submitting returns a fresh
// mock job id immediately; transcription resolves to a canned transcript.
export interface MockSttOptions {
  transcript?: string;
  segments?: TranscriptSegment[];
  durationSeconds?: number;
  status?: TranscriptionStatus;
  jobIdPrefix?: string;
}

export class MockStt implements SpeechToText {
  private readonly transcript: string;
  private readonly segments: TranscriptSegment[] | undefined;
  private readonly durationSeconds: number | undefined;
  private readonly status: TranscriptionStatus;
  private readonly jobIdPrefix: string;
  private counter = 0;

  constructor(options: MockSttOptions = {}) {
    this.transcript = options.transcript ?? "";
    this.segments = options.segments;
    this.durationSeconds = options.durationSeconds;
    this.status = options.status ?? "completed";
    this.jobIdPrefix = options.jobIdPrefix ?? "mock-";
  }

  private nextJobId(): string {
    this.counter += 1;
    return `${this.jobIdPrefix}${this.counter}`;
  }

  async submitTranscription(request: TranscribeRequest): Promise<{ jobId: string }> {
    void request;
    return { jobId: this.nextJobId() };
  }

  async getJobStatus(jobId: string): Promise<{
    status: TranscriptionStatus;
    transcript?: string;
    error?: string;
  }> {
    if (!jobId.startsWith(this.jobIdPrefix)) {
      return { status: "failed", error: `unknown job id "${jobId}"` };
    }
    return {
      status: this.status,
      transcript: this.status === "completed" ? this.transcript : undefined,
    };
  }

  async getTranscript(jobId: string): Promise<TranscriptResult> {
    if (!jobId.startsWith(this.jobIdPrefix)) {
      throw new Error(`unknown job id "${jobId}"`);
    }
    return {
      transcript: this.transcript,
      segments: this.segments,
      durationSeconds: this.durationSeconds,
    };
  }
}

export function createMockStt(options: MockSttOptions = {}): SpeechToText {
  return new MockStt(options);
}

export const mockStt = new MockStt({
  transcript: "Sarah boarded the Relentless.",
  durationSeconds: 12,
});