import { GroupDetail } from "./GroupDetail";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <GroupDetail groupId={id} />
    </div>
  );
}
