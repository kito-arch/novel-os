import type { Metadata } from "next";
import { ErrorBoundary } from "@/ui/error-boundary";
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
      <main className="flex-1 px-4 pt-16 pb-8 sm:px-8 sm:pt-8 lg:pl-8 lg:pt-8">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <TalkWidget storyId={storyId} />
    </div>
  );
}