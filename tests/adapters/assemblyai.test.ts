import { describe, expect, it } from "vitest";
import type { SpeechToText } from "@/container/stt";
import { assemblyaiStt, type AssemblyAiSttOptions } from "@/adapters/assemblyai";

interface FakeTranscriptPayload {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text?: string;
  error?: string;
  audio_duration?: number;
  words?: Array<{ start: number; end: number; text: string; confidence?: number }>;
}

interface FakeRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  jsonBody: Record<string, unknown> | undefined;
}

// Minimal fake of the AssemblyAI v2 REST API: routes /upload + /transcript, keeps
// injected transcript state, and records every request for assertions.
class FakeAssemblyApi {
  readonly requests: FakeRequest[] = [];
  readonly transcripts = new Map<string, FakeTranscriptPayload>();
  private counter = 0;

  nextTranscriptId(): string {
    return `fake-${(this.counter += 1)}`;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    const isJson = headers["content-type"]?.includes("application/json");
    const jsonBody = isJson && init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;

    this.requests.push({ method, path: url.pathname, headers, jsonBody });

    if (method === "POST" && url.pathname.endsWith("/upload")) {
      return jsonResponse({ upload_url: "https://cdn.test/audio/1" });
    }

    const match = /\/transcript\/([^/]+)$/.exec(url.pathname);
    if (method === "POST" && url.pathname.endsWith("/transcript")) {
      const id = this.nextTranscriptId();
      this.transcripts.set(id, {
        id,
        status: "queued",
        ...jsonBody,
      } as unknown as FakeTranscriptPayload);
      return jsonResponse({ id, status: "queued" });
    }
    if (match) {
      if (method === "POST" && url.pathname.endsWith("/transcript/redo")) {
        return jsonResponse({ id: match[1], status: "queued" });
      }
      const transcript = this.transcripts.get(match[1]);
      if (!transcript) return jsonResponse({ error: "Not found" }, 404);
      return jsonResponse(transcript as unknown as Record<string, unknown>);
    }

    return jsonResponse({ error: `Unhandled ${method} ${url.pathname}` }, 404);
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildStt(api: FakeAssemblyApi, overrides: Partial<AssemblyAiSttOptions> = {}): SpeechToText {
  return assemblyaiStt({
    apiKey: "test-key",
    baseUrl: "https://fake.test/v2",
    fetch: api.fetch.bind(api),
    ...overrides,
  });
}

describe("AssemblyAiStt (T10.1)", () => {
  it("uploads audio with the api key and mime type, then submits with webhook echo", async () => {
    const api = new FakeAssemblyApi();
    const stt = buildStt(api);

    const { jobId } = await stt.submitTranscription({
      audioBuffer: Buffer.from("audio bytes"),
      mimeType: "audio/mp3",
      webhookUrl: "https://app.test/api/hooks/stt-callback",
      webhookAuth: { headerName: "x-webhook-secret", headerValue: "secret" },
    });

    expect(api.requests.map((r) => r.method + " " + r.path)).toEqual([
      "POST /v2/upload",
      "POST /v2/transcript",
    ]);
    const upload = api.requests[0];
    expect(upload.headers.authorization).toBe("test-key");
    expect(upload.headers["content-type"]).toBe("audio/mp3");

    const submit = api.requests[1].jsonBody;
    expect(submit).toEqual({
      audio_url: "https://cdn.test/audio/1",
      webhook_url: "https://app.test/api/hooks/stt-callback",
      webhook_auth_header_name: "x-webhook-secret",
      webhook_auth_header_value: "secret",
    });
    expect(jobId).toBe("fake-1");
    expect(api.transcripts.get(jobId)).toBeDefined();
  });

  it("omits webhook fields when no webhookUrl is given", async () => {
    const api = new FakeAssemblyApi();
    const stt = buildStt(api);

    await stt.submitTranscription({ audioBuffer: Buffer.from("x"), mimeType: "audio/wav" });

    expect(api.requests[1].jsonBody).toEqual({ audio_url: "https://cdn.test/audio/1" });
  });

  it("getJobStatus maps queued → processing → completed with transcript text", async () => {
    const api = new FakeAssemblyApi();
    const stt = buildStt(api);
    const { jobId } = await stt.submitTranscription({ audioBuffer: Buffer.from("x"), mimeType: "audio/mp3" });

    expect((await stt.getJobStatus(jobId)).status).toBe("queued");

    const transcript = api.transcripts.get(jobId)!;
    transcript.status = "processing";
    expect((await stt.getJobStatus(jobId)).status).toBe("processing");

    transcript.status = "completed";
    transcript.text = "Sarah boarded the Relentless.";
    const result = await stt.getJobStatus(jobId);
    expect(result.status).toBe("completed");
    expect(result.transcript).toBe("Sarah boarded the Relentless.");
  });

  it("getJobStatus surfaces AssemblyAI errors as failed", async () => {
    const api = new FakeAssemblyApi();
    const stt = buildStt(api);
    const { jobId } = await stt.submitTranscription({ audioBuffer: Buffer.from("x"), mimeType: "audio/mp3" });

    api.transcripts.get(jobId)!.status = "error";
    api.transcripts.get(jobId)!.error = "audio too short";

    const result = await stt.getJobStatus(jobId);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("audio too short");
  });

  it("getTranscript returns text, word segments and duration seconds", async () => {
    const api = new FakeAssemblyApi();
    const stt = buildStt(api);
    const { jobId } = await stt.submitTranscription({ audioBuffer: Buffer.from("x"), mimeType: "audio/mp3" });

    api.transcripts.set(jobId, {
      id: jobId,
      status: "completed",
      text: "Hello world.",
      audio_duration: 1234,
      words: [
        { start: 0, end: 300, text: "Hello" },
        { start: 350, end: 800, text: "world", confidence: 0.98 },
      ],
    });

    const result = await stt.getTranscript(jobId);
    expect(result.transcript).toBe("Hello world.");
    expect(result.durationSeconds).toBeCloseTo(1.234);
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 300, text: "Hello" },
      { startMs: 350, endMs: 800, text: "world", confidence: 0.98 },
    ]);
  });

  it("throws AssemblyAiError when the provider rejects the upload", async () => {
    const api = new FakeAssemblyApi();
    const failing = new FakeAssemblyApi();
    const stt = assemblyaiStt({
      apiKey: "bad-key",
      baseUrl: "https://fake.test/v2",
      fetch: async () => jsonResponse({ error: "invalid api key" }, 401),
    });
    void api;
    void failing;

    await expect(
      stt.submitTranscription({ audioBuffer: Buffer.from("x"), mimeType: "audio/mp3" }),
    ).rejects.toMatchObject({ name: "AssemblyAiError", status: 401 });
  });
});