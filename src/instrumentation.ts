import { validateRuntimeEnv } from "@/config";

export function register() {
  if (process.env.NEXT_RUNTIME !== "edge") {
    validateRuntimeEnv(process.env);
  }
}
