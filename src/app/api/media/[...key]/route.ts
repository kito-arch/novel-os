import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse, type NextRequest } from "next/server";
import { loadConfig } from "@/config";
import { storyGuard } from "@/server/auth";
import { jsonError } from "@/server/http";

// Media proxy: verifies story ownership then issues a 302 redirect to a
// time-limited S3 pre-signed URL. Key format: {storyId}/{uuid}{ext}
// Falls back to a 503 if S3 is not configured (local-dev mode).
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  const { key } = await ctx.params;
  if (!key || key.length < 2) return jsonError(400, "invalid media key");

  const storyId = key[0];
  const config = loadConfig();

  if (!config.S3_BUCKET) {
    return jsonError(503, "media storage not configured");
  }

  const guard = await storyGuard(request, storyId);
  if (guard instanceof NextResponse) return guard;

  const objectKey = key.join("/");
  const client = new S3Client({
    region: config.AWS_REGION ?? "us-east-1",
    ...(config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: config.AWS_ACCESS_KEY_ID, secretAccessKey: config.AWS_SECRET_ACCESS_KEY } }
      : {}),
  });
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
    { expiresIn: 300 },
  );

  return NextResponse.redirect(url, { status: 302 });
}
