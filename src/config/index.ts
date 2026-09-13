import { z } from "zod";

export const configSchema = z
  .object({
    STT_PROVIDER: z.enum(["assemblyai", "mock"]).default("mock"),
    LLM_PROVIDER: z.enum(["openai", "mock"]).default("mock"),
    LLM_CHEAP_MODEL: z.string().default("gpt-5-nano"),
    LLM_STANDARD_MODEL: z.string().default("gpt-5-mini"),
    LLM_BEST_MODEL: z.string().default("gpt-5-pro"),
    DATABASE_URL: z.string().min(1).optional(),
    AWS_REGION: z.string().min(1).optional(),
    SQS_QUEUE_URL: z.string().min(1).optional(),
    WEBHOOK_SECRET: z.string().min(1).optional(),
    STT_API_KEY: z.string().min(1).optional(),
    LLM_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.STT_PROVIDER === "assemblyai" && !value.STT_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STT_API_KEY"],
        message: "STT_API_KEY is required when STT_PROVIDER=assemblyai",
      });
    }
    if (value.LLM_PROVIDER === "openai" && !value.LLM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LLM_API_KEY"],
        message: "LLM_API_KEY is required when LLM_PROVIDER=openai",
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

export type EnvVars = Record<string, string | undefined>;

export function loadConfig(env: EnvVars = process.env): AppConfig {
  return configSchema.parse(env);
}