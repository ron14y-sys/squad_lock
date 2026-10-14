import Link from "next/link";

import { localPath } from "@/app/_components/local-path";
import { ProfileNav } from "@/app/profile/ProfileNav";
import { LocationForm } from "./LocationForm";

export default async function LocationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="flex flex-1 flex-col">
      <div className="sl-page !pb-0">
        <Link href="/groups" className="sl-sub self-start">
          &rsaquo; לקבוצות
        </Link>
        <ProfileNav current="location" />
      </div>
      <LocationForm next={localPath(next)} />
    </div>
  );
}
