import { MissingHomeBanner } from "@/app/_components/MissingHomeBanner";
import { GroupDetail } from "./GroupDetail";
import { GroupFeed } from "./GroupFeed";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-1 flex-col">
      <MissingHomeBanner />
      <GroupDetail groupId={id} />
      <GroupFeed groupId={id} />
    </div>
  );
}
