import type { Metadata } from "next";
import Sidebar from "@/ui/sidebar";
import TalkWidget from "@/ui/talk-widget";

export const metadata: Metadata = {
  title: "Novel OS",
};

export default async function StoryLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ storyId: string }>;
}) {
  const { storyId } = await params;
  return (
    <div className="min-h-screen bg-neutral-50 lg:flex">
      <Sidebar storyId={storyId} />
      <main className="flex-1 px-4 py-8 sm:px-8">{children}</main>
      <TalkWidget storyId={storyId} />
    </div>
  );
}