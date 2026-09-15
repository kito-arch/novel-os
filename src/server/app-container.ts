import type { TypedContainer } from "@evyweb/ioctopus";
import { loadConfig } from "@/config";
import { buildContainer } from "@/container";
import type { AppRegistry } from "@/container";

let app: TypedContainer<AppRegistry> | null = null;
let test: TypedContainer<AppRegistry> | null = null;

// Route handlers resolve the application container through this seam. Tests set
// a memory container (tests/mocks) explicitly so API routes run without
// Postgres/AssemblyAI/OpenAI. The production container is built lazily on first
// request; startup env validation (src/instrumentation.ts) guarantees all
// required vars are present before any request reaches here.
export function resolveContainer(): TypedContainer<AppRegistry> {
  if (test) return test;
  if (app) return app;
  app = buildContainer(loadConfig(process.env));
  return app;
}

export function setTestContainer(container: TypedContainer<AppRegistry>): void {
  test = container;
}

export function resetTestContainer(): void {
  test = null;
}
