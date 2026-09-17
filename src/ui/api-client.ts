// MVP client helpers for talking to the Phase 12 API routes. The x-user-id
// header is the mock auth seam defined in src/server/http.ts; a real session
// will replace it later.
export const STUDIO_USER = "studio-user";

export function studioHeaders(extra?: Record<string, string>): Record<string, string> {
  return { "x-user-id": STUDIO_USER, ...extra };
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the generic message
    }
    throw new Error(message);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined as T;
  return (await response.json()) as T;
}