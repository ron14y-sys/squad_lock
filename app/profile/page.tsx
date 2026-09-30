import { HardConstraintsForm } from "./HardConstraintsForm";
import { ProfileNav } from "./ProfileNav";

export default function ProfilePage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ProfileNav current="constraints" />
      <HardConstraintsForm />
    </div>
  );
}
