import { createContainer, createModule } from "@evyweb/ioctopus";
import type { TypedContainer } from "@evyweb/ioctopus";
import type { AppConfig } from "@/config";
import { loadConfig } from "@/config";
import { SystemClock } from "@/adapters";
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
// in tests/mocks and are never imported by src. Until the real adapters ship
// (T8.2/T8.3 Postgres, T9.1 OpenAI, T10.1 AssemblyAI, T11.1 SQS) this throws a
// descriptive NotImplementedError at binding time instead of a generic crash.
export function buildContainer(config: AppConfig = loadConfig()): TypedContainer<AppRegistry> {
  const container = createContainer<AppRegistry>();
  container.load("app", createAppModule(config));
  container.bind("CLOCK").toClass(SystemClock);

  if (config.STT_PROVIDER === "assemblyai") {
    throw new NotImplementedError(
      "STT_PROVIDER=assemblyai requires the AssemblyAI adapter (Phase 10, T10.1) — not implemented yet",
    );
  }
  throw new NotImplementedError(
    "STT is not implemented: STT_PROVIDER=mock only exists as a mock adapter under tests/mocks (tests only). Configure STT_PROVIDER when T10.1 ships.",
  );

  // The branches below are unreachable until the corresponding adapters exist;
  // they are the shape T8.2/T8.3, T9.1, T11.1 will fill in.
  // container.bind("STT").toClass(/* AssemblyAI adapter */);
  // if (config.LLM_PROVIDER === "openai") { ... }
  // if (config.DATABASE_URL) { ... }
  // if (config.SQS_QUEUE_URL) { ... }
}