import { ProfileNav } from "@/app/profile/ProfileNav";
import { LocationForm } from "./LocationForm";

export default function LocationPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <ProfileNav current="location" />
      <LocationForm />
    </div>
  );
}
