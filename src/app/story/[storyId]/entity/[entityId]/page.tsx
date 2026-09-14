import EntityScreen from "@/ui/entity-screen";

export default async function EntityPage({
  params,
}: {
  params: Promise<{ storyId: string; entityId: string }>;
}) {
  const { storyId, entityId } = await params;
  return <EntityScreen storyId={storyId} entityId={entityId} />;
}
