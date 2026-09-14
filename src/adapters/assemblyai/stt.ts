import type {
  SpeechToText,
  TranscribeRequest,
  TranscriptResult,
  TranscriptSegment,
  TranscriptionStatus,
} from "@/container/stt";

export interface AssemblyAiSttOptions {
  apiKey: string;
  // Test seam + self-host/relay support (defaults to AssemblyAI v2 REST API).
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_BASE_URL = "https://api.assemblyai.com/v2";

export class AssemblyAiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AssemblyAiError";
    this.status = status;
  }
}

interface AssemblyApiJson {
  id?: string;
  status?: string;
  text?: string;
  error?: string;
  audio_duration?: number;
  upload_url?: string;
  words?: Array<{ start: number; end: number; text: string; confidence?: number }>;
}

interface ApiInit {
  method?: string;
  body?: BodyInit;
  headers?: Record<string, string>;
}

// T10.1 — AssemblyAI-backed SpeechToText. Uses the v2 REST API directly (no SDK
// dependency): upload the audio, submit a transcript job with webhook auth echo,
// then poll/fetch by transcript_id — the providerJobId persisted at submit time.
export class AssemblyAiStt implements SpeechToText {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(options: AssemblyAiSttOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch;
  }

  private async requestJson(path: string, init?: ApiInit): Promise<AssemblyApiJson> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: this.apiKey, "Content-Type": "application/json", ...init?.headers },
    });

    const body = (await response.json().catch(() => ({}))) as AssemblyApiJson;
    if (!response.ok) {
      const message = body.error ?? `AssemblyAI ${path} failed with HTTP ${response.status}`;
      throw new AssemblyAiError(message, response.status);
    }
    return body;
  }

  async submitTranscription(request: TranscribeRequest): Promise<{ jobId: string }> {
    const upload = await this.requestJson("/upload", {
      method: "POST",
      headers: { "Content-Type": request.mimeType || "application/octet-stream" },
      body: request.audioBuffer as unknown as BodyInit,
    });
    if (!upload.upload_url) {
      throw new AssemblyAiError("AssemblyAI /upload returned no upload_url", 502);
    }

    const transcript = await this.requestJson("/transcript", {
      method: "POST",
      body: JSON.stringify({
        audio_url: upload.upload_url,
        ...(request.webhookUrl
          ? {
              webhook_url: request.webhookUrl,
              webhook_auth_header_name: request.webhookAuth?.headerName,
              webhook_auth_header_value: request.webhookAuth?.headerValue,
            }
          : {}),
      }),
    });
    if (!transcript.id) {
      throw new AssemblyAiError("AssemblyAI /transcript returned no id", 502);
    }
    return { jobId: transcript.id };
  }

  async getJobStatus(jobId: string): Promise<{
    status: TranscriptionStatus;
    transcript?: string;
    error?: string;
  }> {
    const transcript = await this.requestJson(`/transcript/${jobId}`);
    if (transcript.status === "error") {
      return { status: "failed", error: transcript.error ?? "AssemblyAI transcript error" };
    }
    return {
      status: (transcript.status ?? "queued") as "queued" | "processing" | "completed",
      transcript: transcript.status === "completed" ? transcript.text : undefined,
    };
  }

  async getTranscript(jobId: string): Promise<TranscriptResult> {
    const transcript = await this.requestJson(`/transcript/${jobId}`);
    const segments: TranscriptSegment[] | undefined = transcript.words?.map((word) => ({
      startMs: word.start,
      endMs: word.end,
      text: word.text,
      confidence: word.confidence,
    }));
    return {
      transcript: transcript.text ?? "",
      segments,
      durationSeconds:
        typeof transcript.audio_duration === "number"
          ? transcript.audio_duration / 1000
          : undefined,
    };
  }
}

export function assemblyaiStt(options: AssemblyAiSttOptions): SpeechToText {
  return new AssemblyAiStt(options);
}