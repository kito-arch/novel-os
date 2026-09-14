import type { Metadata } from "next";
import CharacterScreen from "@/ui/character-screen";

export const metadata: Metadata = {
  title: "Character — Novel OS",
};

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ storyId: string; id: string }>;
}) {
  const { storyId, id } = await params;
  return <CharacterScreen storyId={storyId} entityId={id} />;
}