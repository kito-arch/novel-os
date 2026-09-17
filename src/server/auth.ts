import { NextResponse } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";
import { getSessionUserId } from "@/server/session";

// Returns { userId } if the request is authenticated and the user owns the
// story, or a NextResponse error (401/403) the caller should return directly.
export async function storyGuard(
  request: Request,
  storyId: string,
): Promise<{ userId: string } | NextResponse> {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "not authenticated");
  const owns = await resolveContainer().get("STORY_WORLD_STORE").checkStoryOwner(storyId, userId);
  if (!owns) return jsonError(403, "forbidden");
  return { userId };
}

// Returns { userId } for any authenticated request, or a 401 response.
export async function requireAuth(request: Request): Promise<{ userId: string } | NextResponse> {
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "not authenticated");
  return { userId };
}
