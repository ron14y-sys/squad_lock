import { redirect } from "next/navigation";

import { Landing } from "@/app/_components/Landing";
import { auth, signIn } from "@/auth";

// Someone who is signed in has no use for the landing text — their home is the
// all-groups screen (C8, spec §5.6). Signed out, they see it and the sign-in
// button (#171: the first screen itself, not a click away through the
// header's link).
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/groups");

  const { callbackUrl } = await searchParams;

  // Defined here, not inside Landing: this file already isn't unit-tested
  // (auth() makes it async, per Landing's own comment), so this is where the
  // server-only glue belongs. Landing takes it as a plain prop and stays a
  // pure, testable form.
  async function googleSignIn() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl || "/groups" });
  }

  return <Landing onGoogleSignIn={googleSignIn} />;
}
