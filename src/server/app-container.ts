import type { TypedContainer } from "@evyweb/ioctopus";
import type { AppConfig, EnvVars } from "@/config";
import { loadConfig } from "@/config";
import { buildContainer } from "@/container";
import type { AppRegistry } from "@/container";
import { buildDevContainer } from "@/adapters";

// Dev fallback matches drizzle.config.ts so `next dev` works against the local
// Postgres with no DATABASE_URL in the environment (Phase 12 routes depend on
// the world/dictation stores).
export const DEV_DATABASE_URL = "postgres://localhost:5432/novelos";

let app: TypedContainer<AppRegistry> | null = null;
let test: TypedContainer<AppRegistry> | null = null;

// Route handlers resolve the application container through this seam. Tests set
// a memory container (tests/mocks) explicitly so API routes run without
// Postgres/AssemblyAI/OpenAI; production resolves the real container lazily,
// defaulting DATABASE_URL to the local dev Postgres when it is unset.
//
// Provider local-fallback: when the production container can't build because
// external keys are missing (e.g. LLM_API_KEY), a non-production run falls back
// to the in-memory dev container (src/adapters/mock) with a clear warning, so
// `next dev` runs the full concrete flow with zero external services. In
// production the build failure is rethrown — never silently degraded.
export function resolveContainer(): TypedContainer<AppRegistry> {
  if (test) return test;
  if (app) return app;
  try {
    app = buildProductionContainer();
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    console.warn(
      "[novel-os] Production container could not be built — falling back to in-memory dev " +
        "adapters (no LLM/STT keys). Handling status: " +
        (error instanceof Error ? error.message : String(error)),
    );
    app = buildDevContainer();
  }
  return app;
}

function loadProductionConfig(): AppConfig {
  const rawConfig = loadConfig(process.env as EnvVars);
  return rawConfig.DATABASE_URL ? rawConfig : { ...rawConfig, DATABASE_URL: DEV_DATABASE_URL };
}

function buildProductionContainer(): TypedContainer<AppRegistry> {
  const config = loadProductionConfig();
  return buildContainer(config);
}

export function setTestContainer(container: TypedContainer<AppRegistry>): void {
  test = container;
}

export function resetTestContainer(): void {
  test = null;
}