import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

// T12.5 — "Ask my story anything". The ASK_STORY service resolves mentions in
// the question, assembles bounded context, and completes an answer from it.
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const guard = await storyGuard(request, id);
  if (guard instanceof NextResponse) return guard;
  const container = resolveContainer();

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