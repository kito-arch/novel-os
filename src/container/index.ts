import { SQSClient } from "@aws-sdk/client-sqs";
import { createContainer, createModule } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AppConfig } from "@/config";
import { loadConfig } from "@/config";
import {
  SystemClock,
  assemblyaiStt,
  createLanguageModel,
  openaiLlm,
} from "@/adapters";
import { PostgresStoryWorldStore, PostgresTranscriptStore } from "@/adapters/postgres";
import { SqsJobQueue } from "@/adapters/sqs";
import { TranscriptProcessor } from "@/services/llm-agent/transcript-processor";
import * as databaseSchema from "../../drizzle/schema";
import type { AppRegistry } from "./registry";

export * from "./registry";

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

export function createAppModule(config: AppConfig = loadConfig()) {
  const appModule = createModule<AppRegistry>();
  appModule.bind("CONFIG").toValue(config);
  return appModule;
}

// Production container. Only real adapters belong here; mock/test doubles live
// in tests/mocks and are never imported by src. DATABASE_URL enables the real
// Postgres adapters (T8.2/T8.3). Adapters that have not shipped yet (STT →
// T10.1 AssemblyAI, JOB_QUEUE → T11.1 SQS) resolve to a descriptive
// NotImplementedError instead of a generic binding crash; requesting them at
// build time is a misconfiguration the app reports clearly.
export function buildContainer(config: AppConfig = loadConfig()): TypedContainer<AppRegistry> {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(config));
  container.bind("CLOCK").toClass(SystemClock);

  if (config.DATABASE_URL) {
    const client = postgres(config.DATABASE_URL);
    const db = drizzle(client, { schema: databaseSchema });
    container
      .bind("STORY_WORLD_STORE")
      .toValue(new PostgresStoryWorldStore({ db }));
    container.bind("TRANSCRIPT_STORE").toValue(new PostgresTranscriptStore({ db }));
  } else {
    throw new NotImplementedError(
      "DATABASE_URL is required to build the production container (Postgres StoryWorldStore/TranscriptStore, T8.5). " +
        "Production adapters are real-only; in-memory doubles live in tests/mocks.",
    );
  }

  // The extraction agent is wired with its real dependencies: the AI SDK
  // LanguageModel (createLanguageModel, T9) + Postgres StoryWorldStore. The
  // factory is lazy — touched only when TRANSCRIPT_PROCESSOR is requested.
  container
    .bind("TRANSCRIPT_PROCESSOR")
    .toFactory(
      (resolve) =>
        new TranscriptProcessor({
          model: createLanguageModel(resolve("CONFIG")),
          store: resolve("STORY_WORLD_STORE"),
        }),
    );

  // --- Adapters not yet shipped (lazy, descriptive errors on resolve) -----
  if (config.STT_PROVIDER === "assemblyai" && config.STT_API_KEY) {
    container.bind("STT").toValue(assemblyaiStt({ apiKey: config.STT_API_KEY }));
  } else {
    container.bind("STT").toFactory(() => {
      throw new NotImplementedError(
        `STT_PROVIDER=${JSON.stringify(config.STT_PROVIDER)} is not wired in the production container. ` +
          "Set STT_PROVIDER=assemblyai (with STT_API_KEY) to use the AssemblyAI adapter (Phase 10, T10.1). " +
          "Mock STT lives in tests/mocks only.",
      );
    });
  }
  if (config.LLM_PROVIDER === "openai") {
    container
      .bind("LLM")
      .toValue(
        openaiLlm({
          apiKey: config.LLM_API_KEY,
          models: {
            cheap: config.LLM_CHEAP_MODEL,
            standard: config.LLM_STANDARD_MODEL,
            best: config.LLM_BEST_MODEL,
          },
        }),
      );
  } else {
    container.bind("LLM").toFactory(() => {
      throw new NotImplementedError(
        `LLM_PROVIDER=${JSON.stringify(config.LLM_PROVIDER)} is not wired in the production container. ` +
          "Set LLM_PROVIDER=openai (with LLM_API_KEY) to use the OpenAI LlmClient adapter (Phase 9, T9.1).",
      );
    });
  }
  if (config.SQS_QUEUE_URL) {
    container
      .bind("JOB_QUEUE")
      .toValue(
        new SqsJobQueue({
          queueUrl: config.SQS_QUEUE_URL,
          client: new SQSClient({ region: config.AWS_REGION }),
          maxConcurrency: 10,
          resilience: "local-fallback",
          logger: (line) => console.warn(line),
        }),
      );
  } else {
    container.bind("JOB_QUEUE").toFactory(() => {
      throw new NotImplementedError(
        "JOB_QUEUE requires the SQS adapter (Phase 11, T11.1) — set SQS_QUEUE_URL (and AWS_REGION) to enable it.",
      );
    });
  }

  return container;
}