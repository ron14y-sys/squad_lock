// Connect (or reconnect) the signed-in person's Google calendar, then return
// to `callbackUrl`.
//
// Not `/api/auth/signin`: with `pages.signIn` set to "/" that route lands on
// the home page, which sends anyone already signed in straight to /groups —
// so the "reconnect" link took a person whose calendar was disconnected to
// their groups list and asked Google for nothing. Starting the Google flow
// here asks for consent every time (`prompt=consent` in auth.ts), which is
// what shows the calendar checkbox again and issues a new refresh token.

import { localPath } from "@/app/_components/local-path";
import { signIn } from "@/auth";

export async function GET(request: Request): Promise<Response> {
  const callbackUrl = new URL(request.url).searchParams.get("callbackUrl");
  // Throws Next's redirect to Google; nothing after it runs.
  await signIn("google", { redirectTo: localPath(callbackUrl) ?? "/groups" });
  return new Response(null, { status: 500 });
}
