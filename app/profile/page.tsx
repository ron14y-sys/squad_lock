import Link from "next/link";

import { HardConstraintsForm } from "./HardConstraintsForm";
import { ProfileNav } from "./ProfileNav";

export default function ProfilePage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="sl-page !pb-0">
        <Link href="/groups" className="sl-sub self-start">
          &rsaquo; לקבוצות
        </Link>
        <ProfileNav current="constraints" />
      </div>
      <HardConstraintsForm />
    </div>
  );
}
