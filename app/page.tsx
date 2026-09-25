import { redirect } from "next/navigation";

import { Landing } from "@/app/_components/Landing";
import { auth } from "@/auth";

// Someone who is signed in has no use for the landing text — their home is the
// all-groups screen (C8, spec §5.6). Signed out, they see it and the header's
// sign-in link.
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/groups");

  return <Landing />;
}
