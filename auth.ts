// Auth.js (NextAuth v5) configuration (spec §5.2, §6.3 #1, B2/B3).
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
//
// jwt/session callbacks (B3): with no adapter, next-auth has no database
// user id to put in the session on its own — it only knows the OAuth profile
// fields. The jwt callback below looks the User row up by googleId (right
// after signIn has upserted it) and stores its id on the token; the session
// callback copies that id onto session.user.id. This is what lets server
// code elsewhere (e.g. the preference-profile API route) identify "which
// user" via `await auth()` instead of re-deriving it from googleId each
// time. See types/next-auth.d.ts for the corresponding type augmentation.

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
    async jwt({ token, profile }) {
      // Only re-look-up the id right after a sign-in (profile is present
      // then); on every later request Auth.js just decodes the existing
      // token, so this stays a one-time cost per sign-in rather than a
      // database hit on every request.
      if (profile?.sub) {
        const prisma = getPrisma();
        const dbUser = await prisma.user.findUnique({
          where: { googleId: profile.sub },
          select: { id: true },
        });

        if (dbUser) {
          token.id = dbUser.id;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }

      return session;
    },
  },
});
