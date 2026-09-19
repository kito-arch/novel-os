import { z } from "zod";

// Base field definitions — shared by both configSchema and runtimeSchema.
const configFields = {
  STT_PROVIDER: z.enum(["assemblyai", "mock"]).default("mock"),
  // The extraction agent loop (Vercel AI SDK) uses a real provider in both
  // production and development. "mock" is a test-only escape hatch: any
  // real app run must resolve a real LanguageModel, so it defaults to openai.
  LLM_PROVIDER: z.enum(["openai", "anthropic", "mock"]).default("openai"),
  LLM_CHEAP_MODEL: z.string().default("gpt-5-nano"),
  LLM_STANDARD_MODEL: z.string().default("gpt-5-mini"),
  LLM_BEST_MODEL: z.string().default("gpt-5-pro"),
  DATABASE_URL: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  SQS_TRANSCRIPTION_QUEUE_URL: z.string().min(1).optional(),
  SQS_EXTRACTION_QUEUE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).optional(),
  WEBHOOK_SECRET: z.string().min(1).optional(),
  STT_API_KEY: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
};

// Flexible schema — no cross-field checks so Lambdas and tests can call
// loadConfig() without providing credentials for providers they never use.
// Cross-field validation lives only in validateRuntimeEnv() below.
export const configSchema = z.object(configFields);

export type AppConfig = z.infer<typeof configSchema>;

export type EnvVars = Record<string, string | undefined>;

export function loadConfig(env: EnvVars = process.env): AppConfig {
  return configSchema.parse(env);
}

// Stricter runtime schema — DATABASE_URL required + cross-field provider checks.
// Used only at Next.js server startup via validateRuntimeEnv(); never in Lambdas or tests.
const runtimeSchema = z
  .object({ ...configFields, DATABASE_URL: z.string().min(1) })
  .superRefine((value, ctx) => {
    if (value.STT_PROVIDER !== "mock" && !value.STT_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STT_API_KEY"],
        message: "STT_API_KEY is required when STT_PROVIDER=assemblyai",
      });
    }
    if (value.LLM_PROVIDER !== "mock" && !value.LLM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LLM_API_KEY"],
        message: `LLM_API_KEY is required when LLM_PROVIDER=${value.LLM_PROVIDER}`,
      });
    }
  });

// Call once at startup (src/instrumentation.ts) to fail fast with a readable
// list of all missing/invalid env vars rather than crashing on the first request.
export function validateRuntimeEnv(env: EnvVars = process.env): void {
  const result = runtimeSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Server cannot start — invalid environment:\n${issues}`);
  }
}
