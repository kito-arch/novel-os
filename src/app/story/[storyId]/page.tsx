import type { Metadata } from "next";
import { Suspense } from "react";
import StoryScreen from "@/ui/story-screen";

export const metadata: Metadata = {
  title: "Story Bible — Novel OS",
};

export default async function StoryPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Loading story bible…</p>}>
      <StoryScreen storyId={storyId} />
    </Suspense>
  );
}