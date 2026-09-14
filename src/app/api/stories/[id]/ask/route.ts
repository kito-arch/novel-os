import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.5 — "Ask my story anything". The ASK_STORY service resolves mentions in
// the question, assembles bounded context, and completes an answer from it.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const container = resolveContainer();

  if (!(await container.get("STORY_WORLD_STORE").getWorld(id))) {
    return jsonError(404, "story not found");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid JSON body");
  }
  const question = (body as { question?: unknown } | null)?.question;
  if (typeof question !== "string" || question.trim() === "") {
    return jsonError(400, "question required");
  }

  try {
    const answer = await container.get("ASK_STORY")(id, question);
    return NextResponse.json({ answer });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "ask failed");
  }
}