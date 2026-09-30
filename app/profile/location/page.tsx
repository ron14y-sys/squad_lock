import Link from "next/link";

import { ProfileNav } from "@/app/profile/ProfileNav";
import { LocationForm } from "./LocationForm";

export default function LocationPage() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="sl-page !pb-0">
        <Link href="/groups" className="sl-sub self-start">
          &rsaquo; לקבוצות
        </Link>
        <ProfileNav current="location" />
      </div>
      <LocationForm />
    </div>
  );
}
