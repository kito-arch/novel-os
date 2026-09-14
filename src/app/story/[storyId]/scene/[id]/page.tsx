import type { Metadata } from "next";
import SceneDetailScreen from "@/ui/scene-detail-screen";

export const metadata: Metadata = {
  title: "Scene — Novel OS",
};

export default async function SceneDetailPage({
  params,
}: {
  params: Promise<{ storyId: string; id: string }>;
}) {
  const { storyId, id } = await params;
  return <SceneDetailScreen storyId={storyId} sceneId={id} />;
}