import { NextResponse, type NextRequest } from "next/server";
import { knowledgeContext } from "@/services/reasoning/knowledge";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.7 — Does `entityName` know `factDescription`? Resolves the entity by name
// and returns the knowledge status plus a human-readable reason (the matching
// knowledge claims with their timeline annotations).
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const container = resolveContainer();
  const store = container.get("STORY_WORLD_STORE");

  if (!(await store.getWorld(id))) {
    return jsonError(404, "story not found");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const fields = body as { entityName?: unknown; factDescription?: unknown; timeline?: unknown } | null;
  if (typeof fields?.entityName !== "string" || fields.entityName.trim() === "") {
    return jsonError(400, "entityName required");
  }
  if (typeof fields.factDescription !== "string" || fields.factDescription.trim() === "") {
    return jsonError(400, "factDescription required");
  }

  const entity = await store.findEntityByName(id, fields.entityName);
  if (!entity) return jsonError(404, `entity "${fields.entityName}" not found`);
  const timeline = typeof fields.timeline === "string" ? fields.timeline : null;

  const result = await knowledgeContext(store, id, entity.id, fields.factDescription, timeline);
  const context = result.claims.length > 0
    ? result.claims.map((claim) => `[${claim.status}] ${claim.knowledgeText}`).join("\n")
    : "No matching knowledge claim in this story.";

  return NextResponse.json({ status: result.status, context });
}