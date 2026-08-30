// Auth.js (NextAuth v5) configuration (spec §5.2, §6.3 #1, B2).
//
// No database adapter: the schema deliberately keeps OAuth identity as two
// plain fields on User — googleId, googleRefreshToken (prisma/schema.prisma)
// — rather than the Account/Session/VerificationToken tables
// @auth/prisma-adapter expects. Sessions are JWT-based; the signIn callback
// below upserts the User row itself, directly, on every successful sign-in.
//
// Scope is calendar.freebusy ONLY (spec §6.3, §5.2, decision D13) — this is
// what keeps the OAuth consent screen non-sensitive and lets it publish "In
// production" without Google's verification review or Testing mode's 7-day
// refresh-token expiry. Do not add calendar.readonly, calendar.events, or
// any gmail.* scope — see spec §6.3, "Rejected: the Gmail API".
//
// access_type=offline + prompt=consent: Google only issues a refresh token
// on a user's *first* consent unless prompt=consent forces a fresh one every
// time. The app needs that refresh token to call freebusy outside the
// sign-in request itself (a background re-weighing, not just login), so we
// ask for a fresh one on every sign-in rather than relying on catching the
// one-time grant.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { getPrisma } from "@/lib/db/client";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_SECRET,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar.freebusy",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (
        !account ||
        account.provider !== "google" ||
        !profile?.sub ||
        !user.email
      ) {
        return false;
      }

      const prisma = getPrisma();

      await prisma.user.upsert({
        where: { googleId: profile.sub },
        update: {
          email: user.email,
          name: user.name ?? "",
          ...(account.refresh_token
            ? { googleRefreshToken: account.refresh_token }
            : {}),
        },
        create: {
          googleId: profile.sub,
          email: user.email,
          name: user.name ?? "",
          googleRefreshToken: account.refresh_token ?? null,
        },
      });

      return true;
    },
  },
});
