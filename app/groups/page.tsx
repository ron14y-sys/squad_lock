import { MissingHomeBanner } from "@/app/_components/MissingHomeBanner";
import { GroupsList } from "./GroupsList";

export default function GroupsPage() {
  return (
    <div className="flex flex-1 flex-col">
      <MissingHomeBanner />
      <GroupsList />
    </div>
  );
}
