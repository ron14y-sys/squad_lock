// Module augmentation for Auth.js v5 (B3).
//
// The default Session/JWT types don't carry a database user id — next-auth
// only knows the OAuth profile fields (name/email/image). Since we don't use
// a database adapter (see auth.ts), the app is the one that has to thread the
// User.id from the signIn/jwt callback into the session, so server code (API
// routes reading `await auth()`) can know "which user" without re-querying by
// googleId every time. These two augmentations just teach TypeScript that the
// extra field exists.
//
// The JWT interface is declared in @auth/core/jwt, not next-auth/jwt —
// next-auth/jwt.d.ts only does `export * from "@auth/core/jwt"`, and
// augmenting a re-export-only module does not merge with the original
// interface (TypeScript silently creates a disconnected shadow instead, and
// token.id then type-checks as `unknown`/`{}` everywhere else). Augment the
// module that actually declares it.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
  }
}
