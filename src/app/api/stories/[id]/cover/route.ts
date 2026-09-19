import { NextResponse, type NextRequest } from "next/server";
import { resolveContainer } from "@/server/app-container";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";
import { defaultMediaStorage, resolveMediaUrl } from "@/server/media-storage";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;
  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "file required (field name: file)");

  const buffer = Buffer.from(await file.arrayBuffer());
  const key = await defaultMediaStorage.save(buffer, file.name || "cover.bin", {
    userId: guard.userId,
    storyId,
  });

  await resolveContainer().get("STORY_WORLD_STORE").updateStoryCover(storyId, key);
  return NextResponse.json({ url: await resolveMediaUrl(key) });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: storyId } = await ctx.params;
  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;

  await resolveContainer().get("STORY_WORLD_STORE").updateStoryCover(storyId, null);
  return NextResponse.json({ ok: true });
}
