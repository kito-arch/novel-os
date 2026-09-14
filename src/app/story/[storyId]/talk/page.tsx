import type { Metadata } from "next";
import TalkScreen from "@/ui/talk-screen";

export const metadata: Metadata = {
  title: "Talk — Novel OS",
};

export default async function TalkPage({
  params,
}: {
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  return <TalkScreen storyId={storyId} />;
}