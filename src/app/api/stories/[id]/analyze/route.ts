import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { ANALYSIS_TYPES, type AnalysisType } from "@/services/reasoning/continuity";
import { resolveContainer } from "@/server/app-container";
import { jsonError } from "@/server/http";

// T12.6 — Continuity analysis. Validates analysisType against the category
// enum exported by the continuity service and returns the structural + LLM
// reports for the story.
const analysisTypeSchema = z.enum(ANALYSIS_TYPES);

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
  const parsed = analysisTypeSchema.safeParse((body as { analysisType?: unknown } | null)?.analysisType);
  if (!parsed.success) {
    return jsonError(400, `analysisType must be one of: ${ANALYSIS_TYPES.join(", ")}`);
  }

  try {
    const reports = await container.get("CONTINUITY_CHECKER")(id, parsed.data as AnalysisType);
    return NextResponse.json({ reports });
  } catch (error) {
    return jsonError(500, error instanceof Error ? error.message : "analysis failed");
  }
}