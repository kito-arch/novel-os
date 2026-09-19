import { describe, expect, it } from "vitest";
import { configSchema, loadConfig } from "@/config";

describe("loadConfig", () => {
  it("returns dev defaults when env is empty (mock provider override)", () => {
    const config = loadConfig({ LLM_PROVIDER: "mock" });
    expect(config.STT_PROVIDER).toBe("mock");
    expect(config.LLM_PROVIDER).toBe("mock");
    expect(config.LLM_CHEAP_MODEL).toBe("gpt-5-nano");
    expect(config.LLM_STANDARD_MODEL).toBe("gpt-5-mini");
    expect(config.LLM_BEST_MODEL).toBe("gpt-5-pro");
    expect(config.DATABASE_URL).toBeUndefined();
    expect(config.SQS_TRANSCRIPTION_QUEUE_URL).toBeUndefined();
    expect(config.SQS_EXTRACTION_QUEUE_URL).toBeUndefined();
    expect(config.WEBHOOK_SECRET).toBeUndefined();
  });

  it("returns a fully typed config from a complete env", () => {
    const config = loadConfig({
      STT_PROVIDER: "assemblyai",
      STT_API_KEY: "stt-key",
      LLM_PROVIDER: "openai",
      LLM_API_KEY: "llm-key",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/novelos",
      AWS_REGION: "us-east-1",
      SQS_TRANSCRIPTION_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/novelos-transcription",
      SQS_EXTRACTION_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/novelos-extraction",
      WEBHOOK_SECRET: "sup3r-secret",
    });
    expect(config.STT_PROVIDER).toBe("assemblyai");
    expect(config.LLM_PROVIDER).toBe("openai");
    expect(config.DATABASE_URL).toBe("postgresql://user:pass@localhost:5432/novelos");
    expect(config.SQS_TRANSCRIPTION_QUEUE_URL).toContain("novelos-transcription");
    expect(config.SQS_EXTRACTION_QUEUE_URL).toContain("novelos-extraction");
    expect(config.WEBHOOK_SECRET).toBe("sup3r-secret");
  });

  it("throws when STT_PROVIDER=assemblyai but STT_API_KEY is missing", () => {
    expect(() => loadConfig({ STT_PROVIDER: "assemblyai" })).toThrow(
      /STT_API_KEY is required/
    );
  });

  it("throws when LLM_PROVIDER=openai but LLM_API_KEY is missing", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai" })).toThrow(
      /LLM_API_KEY is required/
    );
  });

  it("throws when LLM_PROVIDER=anthropic but LLM_API_KEY is missing", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "anthropic" })).toThrow(
      /LLM_API_KEY is required/
    );
  });

  it("rejects unsupported provider values", () => {
    expect(() => loadConfig({ STT_PROVIDER: "bogus" })).toThrow();
    expect(() => loadConfig({ LLM_PROVIDER: "watson" })).toThrow();
  });

  it("defaults to a real LLM provider (openai) and requires a key", () => {
    expect(() => loadConfig({})).toThrow(/LLM_API_KEY is required when LLM_PROVIDER=openai/);
    const config = loadConfig({ LLM_API_KEY: "dev-key" });
    expect(config.LLM_PROVIDER).toBe("openai");
  });

  it("strips unknown env keys but keeps known ones", () => {
    const config = loadConfig({ PATH: "/usr/bin", LLM_PROVIDER: "mock", LLM_CHEAP_MODEL: "custom-model" });
    expect(config.LLM_CHEAP_MODEL).toBe("custom-model");
    expect("PATH" in config).toBe(false);
  });
});

describe("configSchema", () => {
  it("parses a minimal valid object", () => {
    expect(configSchema.parse({ LLM_PROVIDER: "mock" }).LLM_PROVIDER).toBe("mock");
  });

  it("parses the default real provider when an API key is present", () => {
    expect(configSchema.parse({ LLM_API_KEY: "k" }).LLM_PROVIDER).toBe("openai");
  });
});